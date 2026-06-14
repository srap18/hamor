
-- 1) apply_ship_damage: remove the at_sea (fishing) block and remove attacker prerequisites
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid;
  _tpl int;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100)
    INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s
   WHERE s.id = _ship_id;

  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_owner) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'protected';
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(14400, GREATEST(60,
    ROUND(60 + (LEAST(30, GREATEST(1, _tpl)) - 1) * (14400 - 60) / 29.0)::int
  ));

  UPDATE public.ships_owned AS s
     SET hp = s.max_hp, destroyed_at = NULL, repair_ends_at = NULL
   WHERE s.id = _ship_id
     AND s.destroyed_at IS NOT NULL
     AND s.repair_ends_at IS NOT NULL
     AND s.repair_ends_at <= now();

  SELECT COALESCE(hp, 100) INTO _prev_hp FROM public.ships_owned WHERE id = _ship_id;

  UPDATE public.ships_owned AS s
     SET hp = GREATEST(0, COALESCE(s.hp, 100) - _damage),
         destroyed_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() ELSE s.destroyed_at END,
         repair_ends_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() + (_repair_secs || ' seconds')::interval
           ELSE s.repair_ends_at END,
         at_sea = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 THEN false
           ELSE s.at_sea END,
         fishing_started_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 THEN NULL
           ELSE s.fishing_started_at END
   WHERE s.id = _ship_id
   RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  RETURN QUERY SELECT _resulting_hp, (_resulting_hp = 0), _resulting_repair;
END
$function$;

-- 2) launch_ad_bomb: remove attacker fishing & destroyed-ship prerequisites
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
  _xp_award integer;
  _prot timestamptz;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _total_damage bigint := 0;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN
    RAISE EXCEPTION 'target is a staff account (protected)';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
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
     RETURNING id, COALESCE(max_hp, 0) AS mhp
  )
  SELECT count(*), COALESCE(SUM(mhp), 0) INTO _ships_hit, _total_damage FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, LEAST(_total_damage, 10000000)::int, LEAST(_total_damage, 10000000)::int, true)
  RETURNING id INTO _attack_id;

  _xp_award := 250 * GREATEST(_ships_hit, 0);
  IF _xp_award > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp_award WHERE id = _attacker;
  END IF;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications (recipient_id, kind, title, body, created_by, meta)
  VALUES (
    _target_id, 'attack', '📺 قنبلة إعلانية!',
    COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' فجّر عليك قنبلة إعلانية ودمّر كل سفنك',
    _attacker,
    jsonb_build_object('attack_id', _attack_id, 'ad_bomb_id', _new_id, 'event', 'ad_bomb', 'ships_destroyed', _ships_hit)
  );

  PERFORM public.stamp_global_last_attack(_attacker, _target_id, 'ad_bomb');

  RETURN _new_id;
END;
$function$;

-- 3) launch_nuke: remove attacker fishing & destroyed-ship prerequisites
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
  _xp_award integer;
  _prot timestamptz;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _total_damage bigint := 0;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN
    RAISE EXCEPTION 'target is a staff account (protected)';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no nuke in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
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
     RETURNING id, COALESCE(max_hp, 0) AS mhp
  )
  SELECT count(*), COALESCE(SUM(mhp), 0) INTO _ships_hit, _total_damage FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, LEAST(_total_damage, 10000000)::int, LEAST(_total_damage, 10000000)::int, true)
  RETURNING id INTO _attack_id;

  _xp_award := 250 * GREATEST(_ships_hit, 0);
  IF _xp_award > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp_award WHERE id = _attacker;
  END IF;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications (recipient_id, kind, title, body, created_by, meta)
  VALUES (
    _target_id, 'attack', '☢️ قنبلة نووية!',
    COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' ضربك بقنبلة نووية ودمّر كل سفنك',
    _attacker,
    jsonb_build_object('attack_id', _attack_id, 'event', 'nuke', 'ships_destroyed', _ships_hit)
  );

  PERFORM public.stamp_global_last_attack(_attacker, _target_id, 'nuke');

  RETURN _attack_id;
END;
$function$;
