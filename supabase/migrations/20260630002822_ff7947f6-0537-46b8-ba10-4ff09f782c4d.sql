
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
  _is_market_expert boolean;
  _is_golden_fisher boolean;
  _is_persistent boolean;
  _heal int := 0;
  _affected int := 0;
  _trader_ends timestamptz;
  _crew_label text;
  _gf_current timestamptz;
  _gf_new_until timestamptz;
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
  _is_market_expert   := _crew_id = 'market_expert';
  _is_golden_fisher   := _crew_id = 'golden_fisher';
  _is_persistent      := NOT (_is_fixer OR _is_trader OR _is_market_expert OR _is_golden_fisher);

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
    WHEN 'market_expert' THEN 'خبير الأسواق'
    WHEN 'fixer_1' THEN 'مصلح صغير'
    WHEN 'fixer_2' THEN 'مصلح متوسط'
    WHEN 'fixer_3' THEN 'مصلح كبير'
    WHEN 'fixer_4' THEN 'مصلح أسطوري'
    WHEN 'golden_fisher' THEN 'الصياد الذهبي'
    ELSE _crew_id
  END;

  -- Sender must own the crew (unassigned)
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
  ELSIF _is_golden_fisher THEN
    -- Activate the golden fisher on the recipient (24h auto-fishing + 24h shield).
    -- This mirrors activate_golden_fisher so the gift behaves exactly like the recipient
    -- had a golden fisher in their own inventory and activated it.
    SELECT golden_fisher_until INTO _gf_current
      FROM public.profiles WHERE id = _recipient_id FOR UPDATE;
    _gf_new_until := GREATEST(COALESCE(_gf_current, now()), now()) + interval '24 hours';

    UPDATE public.profiles
       SET golden_fisher_until = _gf_new_until,
           golden_fisher_last_activated_at = now(),
           protection_until = GREATEST(COALESCE(protection_until, _gf_new_until), _gf_new_until)
     WHERE id = _recipient_id;

    -- Cancel anyone currently stealing from the recipient (shield applies immediately).
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL,
           stealing_ends_at = NULL, stealing_started_at = NULL
     WHERE stealing_target_user_id = _recipient_id;

    -- Send all the recipient's idle ships out fishing.
    UPDATE public.ships_owned s
       SET at_sea = true, fishing_started_at = now(), last_fishing_reward_at = now()
      FROM public.ship_catalog c
     WHERE c.code = s.catalog_code
       AND s.user_id = _recipient_id AND s.in_storage = false AND s.destroyed_at IS NULL
       AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
       AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL
       AND (COALESCE(s.at_sea, false) = false OR s.fishing_started_at IS NULL);

    UPDATE public.ships_owned
       SET at_sea = true
     WHERE user_id = _recipient_id AND in_storage = false AND destroyed_at IS NULL
       AND (repair_ends_at IS NULL OR repair_ends_at <= now())
       AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
       AND fishing_started_at IS NOT NULL AND COALESCE(at_sea, false) = false;

    PERFORM public.golden_fisher_tick(_recipient_id);

    _msg := 'صياد ذهبي مفعّل لمدة 24 ساعة + درع كامل';
    _title := '🏅 صياد ذهبي وصلك!';
    _body_action := ' فعّل لك الصياد الذهبي 24 ساعة + درع حماية كامل';
  ELSIF _is_market_expert THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
    VALUES (_recipient_id, 'crew', 'market_expert', 1, NULL);

    _msg := 'خبير الأسواق (في مخزنك)';
    _title := '📈 خبير أسواق وصل مخزنك!';
    _body_action := ' أرسل لك خبير الأسواق — فعّله من المخزن';
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
