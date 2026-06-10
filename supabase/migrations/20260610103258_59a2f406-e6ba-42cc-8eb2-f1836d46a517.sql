CREATE OR REPLACE FUNCTION public.repair_ship_with_crew(_ship_id uuid, _crew_id text)
 RETURNS TABLE(new_hp integer, max_hp integer, repair_ends_at timestamp with time zone, repaired_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _ship record;
  _heal integer;
  _new_hp integer;
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _crew_id NOT IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN RAISE EXCEPTION 'unsupported crew'; END IF;

  SELECT inv.id, inv.quantity INTO _inv
  FROM public.inventory AS inv
  WHERE inv.user_id = _uid
    AND inv.item_type = 'crew'
    AND inv.item_id = _crew_id
    AND (inv.meta IS NULL OR inv.meta->>'assigned_ship_id' IS NULL)
  ORDER BY inv.acquired_at, inv.id
  LIMIT 1
  FOR UPDATE;

  IF _inv.id IS NULL OR COALESCE(_inv.quantity, 0) < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned AS so
       SET hp = so.max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL,
           at_sea = false,
           fishing_started_at = NULL
     WHERE so.user_id = _uid
       AND (COALESCE(so.hp, 0) < COALESCE(so.max_hp, 100) OR so.destroyed_at IS NOT NULL OR so.repair_ends_at IS NOT NULL);
    GET DIAGNOSTICS _count = ROW_COUNT;
    IF _count < 1 THEN RAISE EXCEPTION 'no ships need repair'; END IF;

    IF _inv.quantity <= 1 THEN
      DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
    ELSE
      UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
    END IF;

    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::timestamp with time zone, _count;
    RETURN;
  END IF;

  _heal := CASE _crew_id
    WHEN 'fixer_1' THEN 1000
    WHEN 'fixer_2' THEN 5000
    WHEN 'fixer_3' THEN 70000
    ELSE 0
  END;

  SELECT so.* INTO _ship
  FROM public.ships_owned AS so
  WHERE so.id = _ship_id AND so.user_id = _uid
  FOR UPDATE;

  IF _ship.id IS NULL THEN RAISE EXCEPTION 'not your ship'; END IF;
  IF COALESCE(_ship.hp, 0) >= COALESCE(_ship.max_hp, 100)
     AND _ship.destroyed_at IS NULL
     AND _ship.repair_ends_at IS NULL THEN
    RAISE EXCEPTION 'ship does not need repair';
  END IF;

  _new_hp := LEAST(COALESCE(_ship.max_hp, 100), GREATEST(0, COALESCE(_ship.hp, 0)) + _heal);

  UPDATE public.ships_owned AS so
     SET hp = _new_hp,
         destroyed_at = CASE WHEN _new_hp >= COALESCE(so.max_hp, 100) THEN NULL ELSE so.destroyed_at END,
         repair_ends_at = CASE WHEN _new_hp >= COALESCE(so.max_hp, 100) THEN NULL ELSE so.repair_ends_at END
   WHERE so.id = _ship.id;

  IF _inv.quantity <= 1 THEN
    DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
  ELSE
    UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
  END IF;

  RETURN QUERY
    SELECT s.hp, s.max_hp, s.repair_ends_at, 1
    FROM public.ships_owned AS s
    WHERE s.id = _ship.id;
END $function$;

CREATE OR REPLACE FUNCTION public.use_crew_from_inventory(_inventory_id uuid, _ship_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.inventory%ROWTYPE;
  _ship public.ships_owned%ROWTYPE;
  _ship_owner uuid;
  _crew_id text;
  _expires timestamptz := now() + interval '24 hours';
  _trader_ends timestamptz;
  _snap jsonb;
  _anchor timestamptz;
  _new_id uuid;
  _heal integer;
  _new_hp integer;
  _affected integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO _row
  FROM public.inventory
  WHERE id = _inventory_id
  FOR UPDATE;

  IF _row.id IS NULL OR _row.user_id <> _uid OR _row.item_type <> 'crew' OR _row.quantity < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _row.meta IS NOT NULL AND _row.meta->>'assigned_ship_id' IS NOT NULL THEN
    RAISE EXCEPTION 'crew already used';
  END IF;

  _crew_id := _row.item_id;

  IF _crew_id = 'trader' THEN
    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    _trader_ends := now() + interval '10 hours';
    _snap := public.build_trader_snapshot();
    _anchor := public.trader_snapshot_anchor();

    INSERT INTO public.user_market_state(user_id, trader_until, trader_snapshot, trader_anchor)
      VALUES (_uid, _trader_ends, _snap, _anchor)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
          trader_snapshot = EXCLUDED.trader_snapshot,
          trader_anchor = EXCLUDED.trader_anchor,
          updated_at = now();

    RETURN jsonb_build_object('ok', true, 'kind', 'trader', 'until', _trader_ends);
  END IF;

  IF _ship_id IS NULL THEN
    RAISE EXCEPTION 'missing ship';
  END IF;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _ship_id
  FOR UPDATE;

  _ship_owner := _ship.user_id;
  IF _ship.id IS NULL OR _ship_owner <> _uid THEN
    RAISE EXCEPTION 'ship not found';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned
       SET hp = max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL,
           at_sea = false,
           fishing_started_at = NULL
     WHERE user_id = _uid
       AND (COALESCE(hp, 0) < COALESCE(max_hp, 100) OR destroyed_at IS NOT NULL OR repair_ends_at IS NOT NULL);
    GET DIAGNOSTICS _affected = ROW_COUNT;
    IF _affected < 1 THEN
      RAISE EXCEPTION 'no ships need repair';
    END IF;

    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'repair_all', 'repaired_count', _affected);
  END IF;

  IF _crew_id IN ('fixer_1','fixer_2','fixer_3') THEN
    IF COALESCE(_ship.hp, 0) >= COALESCE(_ship.max_hp, 100)
       AND _ship.destroyed_at IS NULL
       AND _ship.repair_ends_at IS NULL THEN
      RAISE EXCEPTION 'ship does not need repair';
    END IF;

    _heal := CASE _crew_id
      WHEN 'fixer_1' THEN 1000
      WHEN 'fixer_2' THEN 5000
      WHEN 'fixer_3' THEN 70000
      ELSE 0
    END;
    _new_hp := LEAST(COALESCE(_ship.max_hp, 100), GREATEST(0, COALESCE(_ship.hp, 0)) + _heal);

    UPDATE public.ships_owned
       SET hp = _new_hp,
           destroyed_at = CASE WHEN _new_hp >= COALESCE(max_hp, 100) THEN NULL ELSE destroyed_at END,
           repair_ends_at = CASE WHEN _new_hp >= COALESCE(max_hp, 100) THEN NULL ELSE repair_ends_at END
     WHERE id = _ship_id
       AND user_id = _uid;

    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'repair_ship', 'ship_id', _ship_id, 'new_hp', _new_hp, 'max_hp', _ship.max_hp);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory
    WHERE user_id = _uid
      AND item_type = 'crew'
      AND item_id = _crew_id
      AND meta->>'assigned_ship_id' = _ship_id::text
      AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) THEN
    RAISE EXCEPTION 'ship already has this crew';
  END IF;

  IF _row.quantity = 1 THEN
    UPDATE public.inventory
       SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
     WHERE id = _row.id;
    _new_id := _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, 'crew', _crew_id, 1, jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires))
    RETURNING id INTO _new_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', 'assigned', 'id', _new_id, 'ship_id', _ship_id, 'until', _expires);
END;
$function$;

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