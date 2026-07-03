CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid; _tpl int; _repair_secs int;
  _resulting_hp int; _resulting_repair timestamptz;
  _prot timestamptz; _attacker uuid := auth.uid();
  _prev_hp int; _lvl int;
  _req_error text;
  _in_storage boolean;
  _at_sea boolean;
  _destroyed_at timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM public._prep_pvp_checks(_attacker);

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100),
         COALESCE(s.in_storage, false), COALESCE(s.at_sea, false), s.destroyed_at
    INTO _owner, _tpl, _prev_hp, _in_storage, _at_sea, _destroyed_at
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  -- Protect ships that are destroyed, stopped from fishing, or in storage.
  IF _destroyed_at IS NOT NULL OR _prev_hp <= 0 THEN RAISE EXCEPTION 'ship already destroyed'; END IF;
  IF _in_storage THEN RAISE EXCEPTION 'ship in storage'; END IF;
  IF NOT _at_sea THEN RAISE EXCEPTION 'ship not at sea'; END IF;

  PERFORM public._prep_pvp_checks(_owner);

  _req_error := public.pvp_requirement_error(_attacker, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

  _req_error := public.pvp_requirement_error(_owner, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL, shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _tpl := COALESCE(_tpl, 1);
  _lvl := LEAST(30, GREATEST(1, _tpl));
  _repair_secs := ROUND(60 + (_lvl - 1) * (14400 - 60) / 29.0)::int;
  _resulting_hp := GREATEST(0, _prev_hp - GREATEST(0, _damage));
  IF _resulting_hp <= 0 THEN
    _resulting_repair := now() + make_interval(secs => _repair_secs);
    UPDATE public.ships_owned
       SET hp = 0, destroyed_at = now(), repair_ends_at = _resulting_repair,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT 0, true, _resulting_repair;
  ELSE
    UPDATE public.ships_owned
       SET hp = _resulting_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _bomb_dmg int := 70000;
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
   WHERE id = _attacker AND protection_until IS NOT NULL;

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  _blocked := public._try_anti_block(_target_id, 'anti_ad_bomb', 70);

  IF _blocked THEN
    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_target_id, 'anti_block', '🛡️ مضاد القنابل الإعلانية صدّ هجوماً!',
      'صد مضادك قنبلة إعلانية من ' || COALESCE(_attacker_name, 'لاعب'),
      _attacker, jsonb_build_object('anti_id','anti_ad_bomb','attacker_id',_attacker));

    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_attacker, 'anti_block_attacker', '⚠️ تم صد قنبلتك الإعلانية',
      'مضاد ' || COALESCE(_target_name, 'الخصم') || ' صد قنبلتك الإعلانية',
      _target_id, jsonb_build_object('anti_id','anti_ad_bomb','defender_id',_target_id));

    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'قنبلة إعلانية', '📺');

    INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _target_id, 0, 0, false, 0);
    RETURN NULL;
  END IF;

  -- Only ships that are actively at sea, not in storage, and not already destroyed can be hit.
  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND COALESCE(at_sea, false) = true
       AND destroyed_at IS NULL
       AND COALESCE(hp, 0) > 0
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = GREATEST(0, t.old_hp - _bomb_dmg),
           destroyed_at = CASE WHEN t.old_hp <= _bomb_dmg THEN COALESCE(s.destroyed_at, now()) ELSE s.destroyed_at END,
           repair_ends_at = CASE
             WHEN t.old_hp <= _bomb_dmg AND s.repair_ends_at IS NULL THEN now() + interval '4 hours'
             ELSE s.repair_ends_at
           END,
           at_sea = CASE WHEN t.old_hp <= _bomb_dmg THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.old_hp <= _bomb_dmg THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.old_hp <= _bomb_dmg THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.old_hp <= _bomb_dmg THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.old_hp <= _bomb_dmg THEN NULL ELSE s.stealing_ends_at END
      FROM targets t WHERE s.id = t.id
      RETURNING s.id, LEAST(t.old_hp, _bomb_dmg) AS dealt
  )
  SELECT COUNT(*), COALESCE(SUM(dealt), 0) INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key, started_at, expires_at, active)
  VALUES (_target_id, _attacker, _video_key, now(), now() + interval '1 hour', true)
  RETURNING id INTO _new_id;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage, _total_damage, true, 0);

  UPDATE public.profiles
     SET last_destroyer_id = _attacker, last_destroyer_name = _attacker_name,
         last_destroyer_kind = 'ad_bomb', last_destroyer_at = now(),
         bg_burned_until = CASE WHEN _ships_hit > 0 AND EXISTS (
             SELECT 1 FROM public.ships_owned
              WHERE user_id = _target_id AND in_storage = false AND (hp IS NULL OR hp <= 0)
           ) THEN now() + interval '7 days' ELSE bg_burned_until END
   WHERE id = _target_id;

  RETURN _new_id;
END;
$function$;

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
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _nuke_dmg int := 70000;
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
   WHERE id = _attacker AND protection_until IS NOT NULL;

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no nuke in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  _blocked := public._try_anti_block(_target_id, 'anti_nuke', 75);

  IF _blocked THEN
    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_target_id, 'anti_block', '🛡️ مضاد القنابل الذرية صدّ هجوماً!',
      'صد مضادك قنبلة ذرية من ' || COALESCE(_attacker_name, 'لاعب'),
      _attacker, jsonb_build_object('anti_id','anti_nuke','attacker_id',_attacker));

    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_attacker, 'anti_block_attacker', '⚠️ تم صد قنبلتك الذرية',
      'مضاد ' || COALESCE(_target_name, 'الخصم') || ' صد قنبلتك الذرية',
      _target_id, jsonb_build_object('anti_id','anti_nuke','defender_id',_target_id));

    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'قنبلة ذرية', '☢️');

    INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _target_id, 0, 0, false, 0);
    RETURN NULL;
  END IF;

  -- Only ships that are actively at sea, not in storage, and not already destroyed can be hit.
  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND COALESCE(at_sea, false) = true
       AND destroyed_at IS NULL
       AND COALESCE(hp, 0) > 0
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = GREATEST(0, t.old_hp - _nuke_dmg),
           destroyed_at = CASE WHEN t.old_hp <= _nuke_dmg THEN COALESCE(s.destroyed_at, now()) ELSE s.destroyed_at END,
           repair_ends_at = CASE
             WHEN t.old_hp <= _nuke_dmg AND s.repair_ends_at IS NULL THEN now() + interval '4 hours'
             ELSE s.repair_ends_at
           END,
           at_sea = CASE WHEN t.old_hp <= _nuke_dmg THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.old_hp <= _nuke_dmg THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.old_hp <= _nuke_dmg THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.old_hp <= _nuke_dmg THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.old_hp <= _nuke_dmg THEN NULL ELSE s.stealing_ends_at END
      FROM targets t WHERE s.id = t.id
      RETURNING s.id, LEAST(t.old_hp, _nuke_dmg) AS dealt
  )
  SELECT COUNT(*), COALESCE(SUM(dealt), 0) INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage, _total_damage, true, 0)
  RETURNING id INTO _attack_id;

  UPDATE public.profiles
     SET last_destroyer_id = _attacker, last_destroyer_name = _attacker_name,
         last_destroyer_kind = 'nuke', last_destroyer_at = now(),
         bg_burned_until = now() + interval '7 days'
   WHERE id = _target_id;

  RETURN _attack_id;
END;
$function$;