-- Stronger support repair, admin editing, fish editing, and permanent device ban controls

-- 1) Support repair must be real, atomic, and visible from DB state.
CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _sender_name text;
  _sender_emoji text;
  _ship_owner uuid;
  _inv_id uuid;
  _crew_qty int;
  _msg text;
  _title text;
  _body_action text;
  _expires timestamptz := now() + interval '24 hours';
  _is_fixer boolean;
  _is_fixer_legendary boolean;
  _is_trader boolean;
  _is_persistent boolean;
  _heal int := 0;
  _affected int := 0;
  _trader_ends timestamptz;
  _crew_label text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  IF public.is_banned(_me) THEN RAISE EXCEPTION 'account banned'; END IF;
  IF public.is_banned(_recipient_id) THEN RAISE EXCEPTION 'recipient banned'; END IF;

  IF NOT public.is_admin(_me) THEN
    IF NOT public.has_pvp_fleet(_me) THEN
      RAISE EXCEPTION 'sender needs pvp fleet: 3 ships of level 6 or higher';
    END IF;
    IF NOT public.is_market_pvp_unlocked(_recipient_id) THEN
      RAISE EXCEPTION 'recipient is a new player (market level under 6)';
    END IF;
    IF public.users_same_device(_me, _recipient_id) THEN
      INSERT INTO public.account_links(user_a, user_b, link_type, details)
      VALUES (_me, _recipient_id, 'device', jsonb_build_object('via','send_support'))
      ON CONFLICT DO NOTHING;
      PERFORM public.flag_cheat(_me, 'same_device_support', 3,
        jsonb_build_object('recipient', _recipient_id, 'kind', _kind));
      PERFORM public.flag_cheat(_recipient_id, 'same_device_support', 3,
        jsonb_build_object('sender', _me, 'kind', _kind));
      RAISE EXCEPTION 'blocked: cannot send support to an account on the same device';
    END IF;
  END IF;

  SELECT display_name, avatar_emoji INTO _sender_name, _sender_emoji
  FROM public.profiles WHERE id = _me;
  IF _sender_name IS NULL THEN _sender_name := 'صديق'; END IF;
  IF _sender_emoji IS NULL THEN _sender_emoji := '🤝'; END IF;

  SELECT user_id INTO _ship_owner
  FROM public.ships_owned
  WHERE id = _ship_id
  FOR UPDATE;

  IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
    RAISE EXCEPTION 'target ship does not belong to recipient';
  END IF;

  IF _kind = 'repair' THEN
    UPDATE public.ships_owned
       SET hp = max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id
       AND user_id = _recipient_id;
    GET DIAGNOSTICS _affected = ROW_COUNT;
    IF _affected <> 1 THEN
      RAISE EXCEPTION 'repair did not apply';
    END IF;

    _msg := 'إصلاح فوري للسفينة';
    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'repair', 0, _msg, true);
    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id, '🛠️ صلّح لك سفينتك!',
      _sender_emoji || ' ' || _sender_name || ' أصلح سفينتك بالكامل', 'support', _me);
    RETURN;
  END IF;

  IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew id'; END IF;

  _is_fixer           := _crew_id IN ('fixer_1','fixer_2','fixer_3','fixer_4');
  _is_fixer_legendary := _crew_id = 'fixer_4';
  _is_trader          := _crew_id = 'trader';
  _is_persistent      := NOT (_is_fixer OR _is_trader);

  _heal := CASE _crew_id
    WHEN 'fixer_1' THEN 1000
    WHEN 'fixer_2' THEN 5000
    WHEN 'fixer_3' THEN 70000
    ELSE 0
  END;

  _crew_label := CASE _crew_id
    WHEN 'luck' THEN 'الحظ'
    WHEN 'guide' THEN 'المرشد'
    WHEN 'sailor' THEN 'البحار'
    WHEN 'thief' THEN 'اللص'
    WHEN 'police' THEN 'الشرطي'
    WHEN 'trader' THEN 'التاجر'
    WHEN 'fixer_1' THEN 'مصلح صغير'
    WHEN 'fixer_2' THEN 'مصلح متوسط'
    WHEN 'fixer_3' THEN 'مصلح كبير'
    WHEN 'fixer_4' THEN 'مصلح أسطوري'
    ELSE _crew_id
  END;

  SELECT id, quantity INTO _inv_id, _crew_qty
  FROM public.inventory
  WHERE user_id = _me
    AND item_type = 'crew'
    AND item_id = _crew_id
    AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at, id
  LIMIT 1
  FOR UPDATE;

  IF _inv_id IS NULL OR _crew_qty IS NULL OR _crew_qty < 1 THEN
    RAISE EXCEPTION 'sender has no such crew';
  END IF;

  IF _is_persistent THEN
    DELETE FROM public.inventory
    WHERE user_id = _recipient_id
      AND item_type = 'crew'
      AND item_id = _crew_id
      AND meta->>'assigned_ship_id' = _ship_id::text
      AND (meta->>'expires_at') IS NOT NULL
      AND (meta->>'expires_at')::timestamptz <= now();

    IF EXISTS (
      SELECT 1
      FROM public.inventory
      WHERE user_id = _recipient_id
        AND item_type = 'crew'
        AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN
      RAISE EXCEPTION 'recipient ship already has this crew';
    END IF;

    INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
    VALUES (_recipient_id, 'crew', _crew_id, 1,
            jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));

    _msg := 'طاقم: ' || _crew_label;
    _title := '⚓ طاقم وصل سفينتك!';
    _body_action := ' أرسل لك طاقم: ' || _crew_label;
  ELSIF _is_trader THEN
    _trader_ends := now() + interval '10 hours';
    INSERT INTO public.user_market_state(user_id, trader_until)
      VALUES (_recipient_id, _trader_ends)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
          updated_at = now();

    _msg := 'تاجر سوق لمدة 10 ساعات';
    _title := '💰 تاجر سوق وصلك!';
    _body_action := ' أرسل لك تاجر سوق (10 ساعات)';
  ELSIF _is_fixer_legendary THEN
    UPDATE public.ships_owned
       SET hp = max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE user_id = _recipient_id;
    GET DIAGNOSTICS _affected = ROW_COUNT;
    IF _affected < 1 THEN
      RAISE EXCEPTION 'repair did not apply';
    END IF;

    _msg := 'مصلح أسطوري: تعبئة جميع السفن';
    _title := '🏆 مصلح أسطوري عبّى أسطولك!';
    _body_action := ' عبّى لك كل السفن بالكامل';
  ELSIF _is_fixer THEN
    UPDATE public.ships_owned
       SET hp = LEAST(max_hp, GREATEST(0, COALESCE(hp,0)) + _heal),
           destroyed_at = CASE WHEN LEAST(max_hp, GREATEST(0, COALESCE(hp,0)) + _heal) > 0 THEN NULL ELSE destroyed_at END,
           repair_ends_at = CASE WHEN LEAST(max_hp, GREATEST(0, COALESCE(hp,0)) + _heal) >= max_hp THEN NULL ELSE repair_ends_at END
     WHERE id = _ship_id
       AND user_id = _recipient_id;
    GET DIAGNOSTICS _affected = ROW_COUNT;
    IF _affected <> 1 THEN
      RAISE EXCEPTION 'repair did not apply';
    END IF;

    _msg := 'مصلح: +' || _heal || ' دم';
    _title := '🛠️ مصلح أصلح سفينتك!';
    _body_action := ' أصلح سفينتك (+' || _heal || ' دم)';
  ELSE
    RAISE EXCEPTION 'unsupported crew id';
  END IF;

  IF _crew_qty = 1 THEN
    DELETE FROM public.inventory WHERE id = _inv_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
  END IF;

  INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
  VALUES (_me, _recipient_id, _ship_id, 'crew', CASE WHEN _is_fixer_legendary THEN -1 WHEN _is_fixer THEN _heal ELSE 0 END, _msg, true);

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (_recipient_id, _title, _sender_emoji || ' ' || _sender_name || _body_action, 'support', _me);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO authenticated;

-- 2) Admin full profile edit with tracked currency deltas.
CREATE OR REPLACE FUNCTION public.admin_set_player_full(
  _player uuid,
  _coins bigint,
  _gems integer,
  _rubies integer,
  _xp integer,
  _level integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old record;
  _admin uuid := auth.uid();
  _dc bigint;
  _dg integer;
  _dr integer;
  _dx integer;
BEGIN
  IF NOT public.is_admin(_admin) THEN RAISE EXCEPTION 'not admin'; END IF;
  SELECT coins, gems, rubies, xp, level INTO _old FROM public.profiles WHERE id = _player FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;

  _coins := GREATEST(0, COALESCE(_coins, 0));
  _gems := GREATEST(0, COALESCE(_gems, 0));
  _rubies := GREATEST(0, COALESCE(_rubies, 0));
  _xp := GREATEST(0, COALESCE(_xp, 0));
  _level := GREATEST(1, COALESCE(_level, 1));

  _dc := _coins - _old.coins;
  _dg := _gems - _old.gems;
  _dr := _rubies - _old.rubies;
  _dx := _xp - _old.xp;

  UPDATE public.profiles
     SET coins = _coins,
         gems = _gems,
         rubies = _rubies,
         xp = _xp,
         level = _level
   WHERE id = _player;

  IF _dc <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind, meta)
    VALUES (_player, _dc, 'coins', 'admin_set', jsonb_build_object('admin_id', _admin));
  END IF;
  IF _dg <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind, meta)
    VALUES (_player, _dg, 'gems', 'admin_set', jsonb_build_object('admin_id', _admin));
  END IF;
  IF _dr <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind, meta)
    VALUES (_player, _dr, 'rubies', 'admin_set', jsonb_build_object('admin_id', _admin));
  END IF;
  IF _dx <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind, meta)
    VALUES (_player, _dx, 'xp', 'admin_set', jsonb_build_object('admin_id', _admin));
  END IF;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_admin, 'admin_set_player_full', _player,
    jsonb_build_object('coins_delta', _dc, 'gems_delta', _dg, 'rubies_delta', _dr, 'xp_delta', _dx, 'level_from', _old.level, 'level_to', _level));
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_player_full(uuid, bigint, integer, integer, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_player_currency(
  _player uuid, _coins bigint, _gems integer, _xp integer, _level integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _rubies integer;
BEGIN
  SELECT rubies INTO _rubies FROM public.profiles WHERE id = _player;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  PERFORM public.admin_set_player_full(_player, _coins, _gems, _rubies, _xp, _level);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_player_currency(uuid, bigint, integer, integer, integer) TO authenticated;

-- 3) Admin fish inventory/discovery controls.
CREATE OR REPLACE FUNCTION public.admin_get_player_fish(_player uuid)
RETURNS TABLE(fish_id text, quantity integer, total_caught integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  RETURN QUERY
  SELECT fc.fish_id, fc.quantity, fc.total_caught
  FROM public.fish_caught fc
  WHERE fc.user_id = _player
  ORDER BY fc.fish_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_player_fish(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_player_fish(
  _player uuid,
  _fish_id text,
  _quantity integer,
  _total_caught integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _fish_id IS NULL OR length(_fish_id) < 1 OR length(_fish_id) > 80 THEN RAISE EXCEPTION 'bad fish'; END IF;
  _quantity := GREATEST(0, COALESCE(_quantity, 0));
  _total_caught := GREATEST(0, COALESCE(_total_caught, 0));

  IF _quantity = 0 AND _total_caught = 0 THEN
    DELETE FROM public.fish_caught WHERE user_id = _player AND fish_id = _fish_id;
  ELSE
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
    VALUES (_player, _fish_id, _quantity, GREATEST(_total_caught, _quantity), now())
    ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = EXCLUDED.quantity,
          total_caught = EXCLUDED.total_caught,
          updated_at = now();
  END IF;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_set_player_fish', _player,
    jsonb_build_object('fish_id', _fish_id, 'quantity', _quantity, 'total_caught', GREATEST(_total_caught, _quantity)));
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_player_fish(uuid, text, integer, integer) TO authenticated;

-- 4) Permanent device bans and restored device enforcement.
CREATE TABLE IF NOT EXISTS public.banned_devices (
  device_id text PRIMARY KEY,
  user_id uuid,
  reason text NOT NULL DEFAULT '',
  banned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.banned_devices TO authenticated;
GRANT ALL ON public.banned_devices TO service_role;

ALTER TABLE public.banned_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bd_admin_all ON public.banned_devices;
CREATE POLICY bd_admin_all ON public.banned_devices
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_permanent_ban(_uid uuid, _reason text DEFAULT '')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin uuid := auth.uid();
  _n integer := 0;
BEGIN
  IF NOT public.is_admin(_admin) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _uid IS NULL THEN RAISE EXCEPTION 'missing user'; END IF;
  IF _uid = _admin THEN RAISE EXCEPTION 'cannot ban self'; END IF;

  INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
  VALUES (_uid, COALESCE(NULLIF(_reason, ''), 'حظر نهائي'), _admin, NULL, true);

  INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
  SELECT da.device_id, _uid, COALESCE(NULLIF(_reason, ''), 'حظر نهائي'), _admin
  FROM public.device_accounts da
  WHERE da.user_id = _uid
  ON CONFLICT (device_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        reason = EXCLUDED.reason,
        banned_by = EXCLUDED.banned_by;

  GET DIAGNOSTICS _n = ROW_COUNT;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_admin, 'admin_permanent_ban', _uid, jsonb_build_object('reason', COALESCE(_reason, ''), 'devices', _n));

  RETURN _n;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_permanent_ban(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_session(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF public.is_banned(auth.uid()) THEN RAISE EXCEPTION 'account banned'; END IF;
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'invalid token'; END IF;
  UPDATE public.profiles SET active_session_id = _token WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.claim_session(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_device(_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_user uuid;
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _device_id IS NULL OR length(_device_id) < 8 OR length(_device_id) > 160 THEN RAISE EXCEPTION 'invalid device id'; END IF;

  v_is_admin := public.is_admin(v_uid);

  IF v_is_admin THEN
    INSERT INTO public.device_accounts(device_id, user_id)
      VALUES (_device_id, v_uid)
      ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'admin', true);
  END IF;

  IF public.is_banned(v_uid) THEN
    INSERT INTO public.banned_devices(device_id, user_id, reason)
      VALUES (_device_id, v_uid, 'محاولة دخول لحساب محظور')
      ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id, reason = EXCLUDED.reason;
    RAISE EXCEPTION 'account banned';
  END IF;

  IF EXISTS (SELECT 1 FROM public.banned_devices WHERE device_id = _device_id) THEN
    RAISE EXCEPTION 'device banned permanently';
  END IF;

  SELECT user_id INTO v_existing_user
  FROM public.device_accounts
  WHERE device_id = _device_id;

  IF v_existing_user IS NOT NULL AND v_existing_user <> v_uid THEN
    IF public.is_admin(v_existing_user) THEN
      UPDATE public.device_accounts SET user_id = v_uid, updated_at = now() WHERE device_id = _device_id;
      RETURN jsonb_build_object('ok', true);
    END IF;

    IF public.is_banned(v_existing_user) THEN
      INSERT INTO public.banned_devices(device_id, user_id, reason)
      VALUES (_device_id, v_existing_user, 'جهاز مرتبط بحساب محظور')
      ON CONFLICT (device_id) DO NOTHING;
      RAISE EXCEPTION 'device banned permanently';
    END IF;

    RAISE EXCEPTION 'device already bound to another account';
  END IF;

  IF EXISTS (SELECT 1 FROM public.device_accounts WHERE user_id = v_uid AND device_id <> _device_id) THEN
    RAISE EXCEPTION 'account already bound to another device';
  END IF;

  INSERT INTO public.device_accounts(device_id, user_id)
    VALUES (_device_id, v_uid)
    ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_device(text) TO authenticated;

-- Realtime backstop for support-related visible tables.
ALTER TABLE public.inventory REPLICA IDENTITY FULL;
ALTER TABLE public.ships_owned REPLICA IDENTITY FULL;
ALTER TABLE public.support_gifts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ships_owned') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ships_owned;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'support_gifts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_gifts;
  END IF;
END $$;