-- Helper: insert a fresh anti-block notification, or bump the count on an
-- existing one from the same peer for the same anti_id within the last 30 min.
CREATE OR REPLACE FUNCTION public._upsert_anti_block_notif(
  _recipient uuid,
  _kind text,                -- 'anti_block' (recipient=defender) or 'anti_block_attacker' (recipient=attacker)
  _peer_id uuid,             -- attacker uuid (for 'anti_block') or defender uuid (for 'anti_block_attacker')
  _peer_name text,           -- display name of the peer
  _weapon_label text,        -- e.g. 'صاروخ صغير' | 'قنبلة ذرية' | 'قنبلة إعلانية'
  _anti_id text              -- 'anti_rocket' | 'anti_nuke' | 'anti_ad_bomb'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_id uuid;
  _existing_count int;
  _new_count int;
  _key_col text := CASE WHEN _kind = 'anti_block' THEN 'attacker_id' ELSE 'defender_id' END;
  _safe_peer text := COALESCE(NULLIF(_peer_name, ''), CASE WHEN _kind='anti_block' THEN 'لاعب' ELSE 'الخصم' END);
  _title text;
  _body text;
BEGIN
  -- Look for a mergeable notification: same recipient, same kind, same peer, same anti, in last 30 min
  SELECT id, COALESCE((meta->>'count')::int, 1)
    INTO _existing_id, _existing_count
    FROM public.notifications
   WHERE recipient_id = _recipient
     AND kind = _kind
     AND meta->>_key_col = _peer_id::text
     AND COALESCE(meta->>'anti_id','') = _anti_id
     AND created_at > now() - interval '30 minutes'
   ORDER BY created_at DESC
   LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    _new_count := _existing_count + 1;
    IF _kind = 'anti_block' THEN
      _title := '🛡️ صدّ مضادك ' || _new_count || ' هجمات';
      _body  := 'صدّ مضادك ' || _new_count || ' × ' || _weapon_label || ' من ' || _safe_peer;
    ELSE
      _title := '⚠️ صدّ مضاد ' || _safe_peer || ' ' || _new_count || ' هجمات لك';
      _body  := 'مضاد ' || _safe_peer || ' صدّ ' || _new_count || ' × ' || _weapon_label;
    END IF;
    UPDATE public.notifications
       SET title = _title,
           body  = _body,
           created_at = now(),
           created_by = _peer_id,
           meta = COALESCE(meta,'{}'::jsonb)
                  || jsonb_build_object('count', _new_count, 'weapon_label', _weapon_label, 'anti_id', _anti_id, _key_col, _peer_id)
     WHERE id = _existing_id;
    -- Re-mark as unread so the bell surfaces the merged update
    DELETE FROM public.notification_reads WHERE notification_id = _existing_id;
  ELSE
    IF _kind = 'anti_block' THEN
      _title := '🛡️ صدّ مضادك هجوماً';
      _body  := 'صدّ مضادك ' || _weapon_label || ' من ' || _safe_peer;
    ELSE
      _title := '⚠️ صدّ مضاد ' || _safe_peer || ' هجومك';
      _body  := 'مضاد ' || _safe_peer || ' صدّ ' || _weapon_label;
    END IF;
    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_recipient, _kind, _title, _body, _peer_id,
            jsonb_build_object('anti_id', _anti_id, 'count', 1, 'weapon_label', _weapon_label, _key_col, _peer_id));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public._upsert_anti_block_notif(uuid,text,uuid,text,text,text) TO authenticated, service_role;

-- Patch apply_ship_damage_v2: replace the two raw INSERTs on block with the upsert helper.
CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer, blocked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _base_damage integer;
  _weapon_xp integer;
  _mult numeric;
  _final_damage integer;
  _defender uuid;
  _prev_hp integer;
  _actual_damage integer;
  _is_rocket boolean;
  _blocked boolean := false;
  _attacker_name text;
  _defender_name text;
  _def_ship_repair_ends_at timestamptz;
  _result_new_hp integer;
  _result_destroyed boolean;
  _result_repair_ends_at timestamptz;
  _weapon_label text;
  _req_error text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM public._prep_pvp_checks(_attacker);

  SELECT wc.damage, COALESCE(wc.xp,0) INTO _base_damage, _weapon_xp
    FROM public.weapons_catalog AS wc WHERE wc.id = _weapon_id;
  IF _base_damage IS NULL THEN RAISE EXCEPTION 'Unknown weapon: %', _weapon_id; END IF;

  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  SELECT s.user_id, COALESCE(s.hp,0), s.repair_ends_at
    INTO _defender, _prev_hp, _def_ship_repair_ends_at
    FROM public.ships_owned AS s WHERE s.id = _ship_id;
  IF _defender IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _defender = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  PERFORM public._prep_pvp_checks(_defender);

  _req_error := public.pvp_requirement_error(_attacker, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

  _req_error := public.pvp_requirement_error(_defender, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _is_rocket := _weapon_id IN ('rocket_small','rocket_medium','rocket_large');

  IF _is_rocket THEN
    _blocked := public._try_anti_block(_defender, 'anti_rocket', 60);
  END IF;

  IF _blocked THEN
    SELECT p.display_name INTO _attacker_name FROM public.profiles AS p WHERE p.id = _attacker;
    SELECT p.display_name INTO _defender_name FROM public.profiles AS p WHERE p.id = _defender;
    _weapon_label := CASE _weapon_id
      WHEN 'rocket_small' THEN 'صاروخ صغير'
      WHEN 'rocket_medium' THEN 'صاروخ متوسط'
      WHEN 'rocket_large' THEN 'صاروخ كبير'
      ELSE 'صاروخ' END;

    -- Merged notifications: bump an existing recent one instead of stacking
    PERFORM public._upsert_anti_block_notif(_defender, 'anti_block',          _attacker, _attacker_name, _weapon_label, 'anti_rocket');
    PERFORM public._upsert_anti_block_notif(_attacker, 'anti_block_attacker', _defender, _defender_name, _weapon_label, 'anti_rocket');

    RETURN QUERY SELECT _prev_hp, false, _def_ship_repair_ends_at, 0, true;
    RETURN;
  END IF;

  SELECT r.new_hp, r.destroyed, r.repair_ends_at
    INTO _result_new_hp, _result_destroyed, _result_repair_ends_at
    FROM public.apply_ship_damage(_ship_id, _final_damage) AS r;

  _actual_damage := GREATEST(0, _prev_hp - COALESCE(_result_new_hp, 0));

  IF _weapon_xp > 0 THEN
    PERFORM public.add_xp(_attacker, _weapon_xp);
  END IF;

  RETURN QUERY SELECT _result_new_hp, _result_destroyed, _result_repair_ends_at, _actual_damage, false;
END
$function$;

-- Patch launch_nuke: same dedupe on block
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
    PERFORM public._upsert_anti_block_notif(_target_id, 'anti_block',          _attacker, _attacker_name, 'قنبلة ذرية', 'anti_nuke');
    PERFORM public._upsert_anti_block_notif(_attacker,  'anti_block_attacker', _target_id, _target_name,  'قنبلة ذرية', 'anti_nuke');

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
           stealing_ends_at        = CASE WHEN t.old_hp <= _nuke_dmg THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING (t.old_hp - GREATEST(0, t.old_hp - _nuke_dmg)) AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
   VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
   RETURNING id INTO _attack_id;

  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES ('nuke', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
          'ضرب بقنبلة ذرية', '☢️');

  RETURN _attack_id;
END
$function$;

-- Patch launch_ad_bomb: same dedupe on block
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
    PERFORM public._upsert_anti_block_notif(_target_id, 'anti_block',          _attacker, _attacker_name, 'قنبلة إعلانية', 'anti_ad_bomb');
    PERFORM public._upsert_anti_block_notif(_attacker,  'anti_block_attacker', _target_id, _target_name,  'قنبلة إعلانية', 'anti_ad_bomb');

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
           stealing_ends_at        = CASE WHEN t.old_hp <= _bomb_dmg THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING (t.old_hp - GREATEST(0, t.old_hp - _bomb_dmg)) AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
   VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
   RETURNING id INTO _new_id;

  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES ('ad_bomb', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
          'ضرب بقنبلة إعلانية', '📺');

  RETURN _new_id;
END
$function$;