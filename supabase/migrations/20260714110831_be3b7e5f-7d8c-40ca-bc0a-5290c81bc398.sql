
-- 1) سفن الهجوم: ٣ سفن مستوى ٦+ مبحرة وفي وضع الصيد (وليست في مهمة سرقة)
CREATE OR REPLACE FUNCTION public.has_pvp_attack_fleet(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(COUNT(*),0) >= 3
  FROM public.ships_owned s
  LEFT JOIN public.ship_catalog sc ON sc.code = s.catalog_code
  WHERE s.user_id = _user_id
    AND COALESCE(s.at_sea, false) = true
    AND s.destroyed_at IS NULL
    AND s.fishing_started_at IS NOT NULL
    AND (s.stealing_ends_at IS NULL OR s.stealing_ends_at <= now())
    AND GREATEST(
      COALESCE(s.template_id, 0),
      COALESCE(sc.market_level_required, 0),
      COALESCE((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
      CASE WHEN COALESCE(s.max_hp, 0) >= 1800 THEN 6 ELSE 0 END
    ) >= 6
$$;
GRANT EXECUTE ON FUNCTION public.has_pvp_attack_fleet(uuid) TO authenticated, service_role;

-- 2) شرط المهاجم في الهجوم: سوق ≥٦ + ٣ سفن صيد
CREATE OR REPLACE FUNCTION public.pvp_attacker_requirement_error(_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _market int;
BEGIN
  _market := public.effective_market_level(_user_id);
  IF _market < 6 THEN
    RETURN 'attacker market level under 6: current=' || _market::text;
  END IF;
  IF NOT public.has_pvp_attack_fleet(_user_id) THEN
    RETURN 'يجب أن يكون لديك ٣ سفن مستوى ٦ أو أعلى مبحرة وفي وضع الصيد';
  END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.pvp_attacker_requirement_error(uuid) TO authenticated, service_role;

-- 3) شرط المدافع: سوق ≥٦ فقط
CREATE OR REPLACE FUNCTION public.pvp_defender_requirement_error(_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _market int;
BEGIN
  _market := public.effective_market_level(_user_id);
  IF _market < 6 THEN
    RETURN 'defender market level under 6: current=' || _market::text;
  END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.pvp_defender_requirement_error(uuid) TO authenticated, service_role;

-- 4) الدعم يتطلب سوق ≥١٠
CREATE OR REPLACE FUNCTION public.pvp_support_requirement_error(_user_id uuid, _actor_label text DEFAULT 'sender'::text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _market int;
BEGIN
  _market := public.effective_market_level(_user_id);
  IF _market < 10 THEN
    RETURN COALESCE(_actor_label,'sender') || ' يجب أن يكون مستوى سوق السفن ١٠ أو أعلى: الحالي=' || _market::text;
  END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.pvp_support_requirement_error(uuid, text) TO authenticated, service_role;

-- 5) شرط السرقة: سوق ≥٦ فقط
CREATE OR REPLACE FUNCTION public.pvp_steal_requirement_error(_user_id uuid, _actor_label text DEFAULT 'attacker'::text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _market int;
BEGIN
  _market := public.effective_market_level(_user_id);
  IF _market < 6 THEN
    RETURN COALESCE(_actor_label,'attacker') || ' market level under 6: current=' || _market::text;
  END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.pvp_steal_requirement_error(uuid, text) TO authenticated, service_role;

-- 6) تحديث record_attack ليستخدم شروط المهاجم/المدافع الجديدة
CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _def_prot timestamptz;
  _def_gf timestamptz;
  _def_gf_no_shield boolean;
  _mult numeric;
  _req_error text;
  _gf_shields boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  PERFORM public._enforce_combat_cooldown();
  PERFORM public._prep_pvp_checks(_uid);
  PERFORM public._prep_pvp_checks(_defender_id);

  IF NOT public.is_admin(_uid) THEN
    _req_error := public.pvp_attacker_requirement_error(_uid);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
    _req_error := public.pvp_defender_requirement_error(_defender_id);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  END IF;

  SELECT protection_until, golden_fisher_until, COALESCE(golden_fisher_no_shield, false)
    INTO _def_prot, _def_gf, _def_gf_no_shield
    FROM public.profiles WHERE id = _defender_id;

  _gf_shields := (_def_gf IS NOT NULL AND _def_gf > now() AND NOT _def_gf_no_shield);

  IF (_def_prot IS NOT NULL AND _def_prot > now()) OR _gf_shields THEN
    IF _gf_shields THEN
      UPDATE public.profiles
        SET protection_until = GREATEST(COALESCE(protection_until, _def_gf), _def_gf)
        WHERE id = _defender_id;
    END IF;
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now();

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END
$function$;

-- 7) تحديث launch_nuke_impl و launch_ad_bomb_impl ليستخدم شروط المهاجم الجديدة + المدافع بسوق ٦
CREATE OR REPLACE FUNCTION public.launch_nuke_impl(_target_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  _dmg constant integer := 70000;
  _err text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;

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

  WITH targets AS (
    SELECT id, template_id,
           COALESCE(hp, max_hp, 100) AS old_hp,
           LEAST(_dmg, COALESCE(hp, max_hp, 100)) AS applied_dmg,
           GREATEST(COALESCE(hp, max_hp, 100) - _dmg, 0) AS new_hp
      FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND destroyed_at IS NULL
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = t.new_hp,
           destroyed_at = CASE WHEN t.new_hp <= 0 THEN COALESCE(s.destroyed_at, now()) ELSE s.destroyed_at END,
           repair_ends_at = CASE
             WHEN t.new_hp <= 0
               THEN COALESCE(s.repair_ends_at, now() + make_interval(secs => public._ship_repair_seconds(t.template_id)))
             ELSE s.repair_ends_at
           END,
           at_sea = CASE WHEN t.new_hp <= 0 THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING t.applied_dmg AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
  RETURNING id INTO _attack_id;
  RETURN _attack_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.launch_ad_bomb_impl(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _bomb_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _dmg constant integer := 70000;
  _err text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;

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

  WITH targets AS (
    SELECT id, template_id,
           COALESCE(hp, max_hp, 100) AS old_hp,
           LEAST(_dmg, COALESCE(hp, max_hp, 100)) AS applied_dmg,
           GREATEST(COALESCE(hp, max_hp, 100) - _dmg, 0) AS new_hp
      FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND destroyed_at IS NULL
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = t.new_hp,
           destroyed_at = CASE WHEN t.new_hp <= 0 THEN COALESCE(s.destroyed_at, now()) ELSE s.destroyed_at END,
           repair_ends_at = CASE
             WHEN t.new_hp <= 0
               THEN COALESCE(s.repair_ends_at, now() + make_interval(secs => public._ship_repair_seconds(t.template_id)))
             ELSE s.repair_ends_at
           END,
           at_sea = CASE WHEN t.new_hp <= 0 THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING t.applied_dmg AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END
$function$;

-- 8) تحديث start_steal_mission_impl ليستخدم شرط السرقة (سوق ≥٦ فقط)
CREATE OR REPLACE FUNCTION public.start_steal_mission_impl(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS TABLE(ends_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _secs integer;
  _ends timestamptz;
  _started timestamptz := now();
  _target_protection timestamptz;
  _target_golden_until timestamptz;
  _target_gf_no_shield boolean;
  _target_gf_shields boolean;
  _req_error text;
  _existing_raider uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF public.is_admin(_target_user_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_target_user_id);

  _req_error := public.pvp_steal_requirement_error(_me, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  _req_error := public.pvp_steal_requirement_error(_target_user_id, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

  IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN
    RAISE EXCEPTION 'blocked: cannot steal from an account on the same device';
  END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _me AND protection_until IS NOT NULL;

  SELECT protection_until, public.golden_fisher_active_until(id), COALESCE(golden_fisher_no_shield, false)
    INTO _target_protection, _target_golden_until, _target_gf_no_shield
  FROM public.profiles WHERE id = _target_user_id FOR UPDATE;

  _target_gf_shields := (_target_golden_until IS NOT NULL AND _target_golden_until > now() AND NOT _target_gf_no_shield);

  IF (_target_protection IS NOT NULL AND _target_protection > now()) OR _target_gf_shields THEN
    IF _target_gf_shields THEN
      UPDATE public.profiles
         SET protection_until = GREATEST(COALESCE(protection_until, now()), COALESCE(_target_golden_until, protection_until, now()))
       WHERE id = _target_user_id;
    END IF;
    RAISE EXCEPTION 'target is shielded';
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my_ship.id IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.in_storage THEN RAISE EXCEPTION 'attacker ship in storage'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'attacker ship destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'attacker ship busy'; END IF;
  IF _my_ship.stealing_ends_at IS NOT NULL AND _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'attacker ship already stealing';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;
  IF _their_ship.id IS NULL THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'target ship not fishing';
  END IF;

  SELECT id INTO _existing_raider
    FROM public.ships_owned
   WHERE stealing_target_ship_id = _target_ship_id
     AND stealing_ends_at IS NOT NULL
     AND stealing_ends_at > now()
     AND id <> _attacker_ship_id
   LIMIT 1;
  IF _existing_raider IS NOT NULL THEN
    RAISE EXCEPTION 'target ship is already being raided by another pirate';
  END IF;

  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _my_ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_my_ship.template_id, 1) AND active = true LIMIT 1;
  END IF;

  _secs := GREATEST(60, COALESCE(_cat.fishing_seconds, 300));
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_started_at = _started,
         stealing_ends_at = _ends,
         at_sea = true,
         fishing_started_at = NULL
   WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _ends;
END
$function$;
