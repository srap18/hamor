CREATE OR REPLACE FUNCTION public.drop_my_protection()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.drop_my_protection() TO authenticated;
GRANT EXECUTE ON FUNCTION public.drop_my_protection() TO service_role;

CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _new uuid;
  _market_level int;
  _active_count int;
  _storage_count int;
  _put_in_storage boolean := false;
  _cur_coins bigint;
  _cat record;
  _required_level int;
  _stored_template int;
  _stored_hp int;
  _server_price bigint;
  _server_hp int;
  _vip_level smallint := 0;
  _cashback bigint := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO _cat
    FROM public.ship_catalog
   WHERE code = _code AND active = true
   LIMIT 1;
  IF _cat.code IS NULL THEN
    RAISE EXCEPTION 'unknown ship code';
  END IF;

  _server_price := COALESCE(_cat.price_coins, 0);
  IF _server_price <= 0 THEN
    RAISE EXCEPTION 'ship not purchasable with coins';
  END IF;

  _required_level := COALESCE(_cat.market_level_required, 1);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _server_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN COALESCE(_cat.max_hp, 100)
    ELSE COALESCE(_cat.max_hp, 100)
  END;
  _stored_hp := _server_hp;

  SELECT level INTO _market_level
    FROM public.user_market
   WHERE user_id = _uid;
  IF _market_level IS NULL THEN
    _market_level := 1;
  END IF;
  IF _required_level > _market_level THEN
    RAISE EXCEPTION 'market level too low';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned
  WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN
      RAISE EXCEPTION 'fleet and storage full';
    END IF;
    _put_in_storage := true;
  END IF;

  SELECT coins INTO _cur_coins
    FROM public.profiles
   WHERE id = _uid
   FOR UPDATE;
  IF _cur_coins IS NULL THEN
    RAISE EXCEPTION 'no profile';
  END IF;
  IF _cur_coins < _server_price THEN
    RAISE EXCEPTION 'insufficient coins';
  END IF;

  PERFORM public._mutate_currency(_uid, -_server_price, 0, 0, 0);

  _vip_level := COALESCE(public.get_elite_vip_level(_uid), 0);
  IF _vip_level > 0 THEN
    _cashback := FLOOR(_server_price * 0.30)::bigint;
    IF _cashback > 0 THEN
      PERFORM public._mutate_currency(_uid, _cashback, 0, 0, 0);
    END IF;
  END IF;

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
  VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, 1)
  RETURNING id INTO _new;

  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text, integer, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text, integer, bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
  _tpl int;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
  _lvl int;
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

  UPDATE public.profiles
     SET protection_until = NULL
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
    UPDATE public.ships_owned SET hp = _resulting_hp WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.launch_nuke(_target_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp FROM public.ships_owned
     WHERE user_id = _target_id AND in_storage = false FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0, destroyed_at = COALESCE(s.destroyed_at, now()),
           repair_ends_at = CASE WHEN s.repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE s.repair_ends_at END,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
      FROM targets t WHERE s.id = t.id RETURNING s.id, t.old_hp
  )
  SELECT COUNT(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM upd;

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
$$;

GRANT EXECUTE ON FUNCTION public.launch_nuke(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.launch_nuke(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp FROM public.ships_owned
     WHERE user_id = _target_id AND in_storage = false FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0, destroyed_at = COALESCE(s.destroyed_at, now()),
           repair_ends_at = CASE WHEN s.repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE s.repair_ends_at END,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
      FROM targets t WHERE s.id = t.id RETURNING s.id, t.old_hp
  )
  SELECT COUNT(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key, started_at, expires_at, active)
  VALUES (_target_id, _attacker, _video_key, now(), now() + interval '1 hour', true)
  RETURNING id INTO _new_id;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage, _total_damage, true, 0);

  UPDATE public.profiles
     SET last_destroyer_id = _attacker, last_destroyer_name = _attacker_name,
         last_destroyer_kind = 'ad_bomb', last_destroyer_at = now(),
         bg_burned_until = now() + interval '7 days'
   WHERE id = _target_id;

  RETURN _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.launch_ad_bomb(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.launch_ad_bomb(uuid, text) TO service_role;