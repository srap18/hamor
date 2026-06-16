
-- Helper: attacker must have no destroyed (broken) ship sitting in repair queue
CREATE OR REPLACE FUNCTION public.attacker_has_destroyed_ship(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _user_id
       AND in_storage = false
       AND (destroyed_at IS NOT NULL OR (repair_ends_at IS NOT NULL AND repair_ends_at > now()) OR COALESCE(hp,0) = 0)
  )
$function$;

-- Add destroyed-ship gate to single-target weapons
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid; _tpl int; _repair_secs int; _resulting_hp int; _resulting_repair timestamptz;
  _prot timestamptz; _attacker uuid := auth.uid(); _prev_hp int; _lvl int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100) INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_owner) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;
  _tpl := COALESCE(_tpl, 1);
  _lvl := LEAST(30, GREATEST(1, _tpl));
  _repair_secs := ROUND(60 + (_lvl - 1) * (14400 - 60) / 29.0)::int;
  _resulting_hp := GREATEST(0, _prev_hp - GREATEST(0, _damage));
  IF _resulting_hp <= 0 THEN
    _resulting_repair := now() + make_interval(secs => _repair_secs);
    UPDATE public.ships_owned
       SET hp = 0, destroyed_at = now(), repair_ends_at = _resulting_repair,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT 0, true, _resulting_repair;
  ELSE
    UPDATE public.ships_owned SET hp = _resulting_hp WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END $function$;

-- Add destroyed-ship gate to nuke
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
  _weapon_xp integer;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
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

  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp
      FROM public.ships_owned
     WHERE user_id = _target_id AND in_storage = false
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0,
           destroyed_at = COALESCE(s.destroyed_at, now()),
           repair_ends_at = CASE WHEN s.repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE s.repair_ends_at END,
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
      FROM targets t
     WHERE s.id = t.id
    RETURNING s.id, t.old_hp
  )
  SELECT COUNT(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM upd;

  SELECT display_name, COALESCE(profile_emoji, '⚓') INTO _attacker_name, _attacker_emoji
    FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.attacks (attacker_id, defender_id, weapon_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, 'nuke', _total_damage, _total_damage, true, 0)
  RETURNING id INTO _attack_id;

  UPDATE public.profiles
     SET last_destroyer_id = _attacker,
         last_destroyer_name = _attacker_name,
         last_destroyer_emoji = _attacker_emoji,
         last_destroyer_kind = 'nuke',
         last_destroyed_at = now(),
         bg_burned_until = now() + interval '7 days'
   WHERE id = _target_id;

  _weapon_xp := 500;
  PERFORM public.add_xp(_attacker, _weapon_xp);

  RETURN _attack_id;
END;
$function$;

-- Add destroyed-ship gate to ad bomb
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
  _weapon_xp integer;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
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

  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp
      FROM public.ships_owned
     WHERE user_id = _target_id AND in_storage = false
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0,
           destroyed_at = COALESCE(s.destroyed_at, now()),
           repair_ends_at = CASE WHEN s.repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE s.repair_ends_at END,
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
      FROM targets t
     WHERE s.id = t.id
    RETURNING s.id, t.old_hp
  )
  SELECT COUNT(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM upd;

  SELECT display_name, COALESCE(profile_emoji, '⚓') INTO _attacker_name, _attacker_emoji
    FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key, started_at, expires_at, active)
  VALUES (_target_id, _attacker, _video_key, now(), now() + interval '1 hour', true)
  RETURNING id INTO _new_id;

  INSERT INTO public.attacks (attacker_id, defender_id, weapon_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, 'ad_bomb', _total_damage, _total_damage, true, 0)
  RETURNING id INTO _attack_id;

  UPDATE public.profiles
     SET last_destroyer_id = _attacker,
         last_destroyer_name = _attacker_name,
         last_destroyer_emoji = _attacker_emoji,
         last_destroyer_kind = 'ad_bomb',
         last_destroyed_at = now(),
         bg_burned_until = now() + interval '7 days'
   WHERE id = _target_id;

  _weapon_xp := 250;
  PERFORM public.add_xp(_attacker, _weapon_xp);

  RETURN _new_id;
END;
$function$;
