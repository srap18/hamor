
-- regular weapons: award xp = damage applied
CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _base_damage integer;
  _mult numeric;
  _final_damage integer;
  _result record;
  _defender uuid;
  _prev_hp integer;
  _actual_damage integer;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT damage INTO _base_damage FROM public.weapons_catalog WHERE id = _weapon_id;
  IF _base_damage IS NULL THEN RAISE EXCEPTION 'Unknown weapon: %', _weapon_id; END IF;

  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  SELECT user_id, COALESCE(hp,0) INTO _defender, _prev_hp FROM public.ships_owned WHERE id = _ship_id;

  SELECT * INTO _result
  FROM public.apply_ship_damage(_ship_id, _final_damage, _skip_fishing_check);

  _actual_damage := GREATEST(0, COALESCE(_prev_hp,0) - COALESCE(_result.new_hp,0));

  IF _defender IS NOT NULL AND _defender <> _attacker THEN
    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (_attacker, _defender, _ship_id, _final_damage, _actual_damage, COALESCE(_result.destroyed, false), 0);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    IF _actual_damage > 0 THEN
      UPDATE public.profiles SET xp = COALESCE(xp,0) + _actual_damage WHERE id = _attacker;
    END IF;
  END IF;

  RETURN QUERY SELECT _result.new_hp, _result.destroyed, _result.repair_ends_at, _final_damage;
END;
$function$;

-- nuke: xp = sum of HP destroyed
CREATE OR REPLACE FUNCTION public.launch_nuke(_target_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _attack_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _total_damage bigint := 0;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no nuke in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  END IF;

  WITH hit AS (
    UPDATE public.ships_owned
       SET hp = 0,
           destroyed_at = COALESCE(destroyed_at, now()),
           repair_ends_at = CASE WHEN repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE repair_ends_at END,
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
     WHERE user_id = _target_id AND in_storage = false
     RETURNING id, COALESCE(hp, 0) AS old_hp
  )
  SELECT count(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM hit;

  -- old_hp captured before UPDATE applies = previous hp; sum is total damage dealt
  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, LEAST(_total_damage, 2000000000)::int, LEAST(_total_damage, 2000000000)::int, true)
  RETURNING id INTO _attack_id;

  IF _total_damage > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + LEAST(_total_damage, 2000000000)::int WHERE id = _attacker;
  END IF;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications (recipient_id, kind, title, body, created_by, meta)
  VALUES (_target_id, 'attack', '☢️ قنبلة نووية!',
    COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' ضربك بقنبلة نووية ودمّر كل سفنك',
    _attacker,
    jsonb_build_object('attack_id', _attack_id, 'event', 'nuke', 'ships_destroyed', _ships_hit, 'damage', _total_damage));

  BEGIN
    PERFORM public.stamp_global_last_attack(_attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'), 'nuke');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN _attack_id;
END;
$function$;

-- ad_bomb: xp = sum of HP destroyed
CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _attack_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _total_damage bigint := 0;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  WITH hit AS (
    UPDATE public.ships_owned
       SET hp = 0,
           destroyed_at = COALESCE(destroyed_at, now()),
           repair_ends_at = CASE WHEN repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE repair_ends_at END,
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
     WHERE user_id = _target_id AND in_storage = false
     RETURNING id, COALESCE(hp, 0) AS old_hp
  )
  SELECT count(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, LEAST(_total_damage, 2000000000)::int, LEAST(_total_damage, 2000000000)::int, true)
  RETURNING id INTO _attack_id;

  IF _total_damage > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + LEAST(_total_damage, 2000000000)::int WHERE id = _attacker;
  END IF;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications (recipient_id, kind, title, body, created_by, meta)
  VALUES (_target_id, 'attack', '📺 قنبلة إعلانية!',
    COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' فجّر عليك قنبلة إعلانية ودمّر كل سفنك',
    _attacker,
    jsonb_build_object('attack_id', _attack_id, 'ad_bomb_id', _new_id, 'event', 'ad_bomb', 'ships_destroyed', _ships_hit, 'damage', _total_damage));

  BEGIN
    PERFORM public.stamp_global_last_attack(_attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'), 'ad_bomb');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN _new_id;
END;
$function$;
