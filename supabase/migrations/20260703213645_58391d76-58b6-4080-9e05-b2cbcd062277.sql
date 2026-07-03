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
  _req_error text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_recipient_id);

  IF public.is_banned(_me) THEN RAISE EXCEPTION 'account banned'; END IF;
  IF public.is_banned(_recipient_id) THEN RAISE EXCEPTION 'recipient banned'; END IF;

  IF NOT public.is_admin(_me) THEN
    _req_error := public.pvp_requirement_error(_me, 'sender');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

    _req_error := public.pvp_requirement_error(_recipient_id, 'recipient');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'recipient is a new player (%).', _req_error; END IF;

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

  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
    RAISE EXCEPTION 'target ship does not belong to recipient';
  END IF;

  IF _kind = 'repair' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE id = _ship_id AND user_id = _recipient_id;
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
    WHEN 'fixer_1' THEN 1000 WHEN 'fixer_2' THEN 5000 WHEN 'fixer_3' THEN 70000
    ELSE 0 END;

  _crew_label := CASE _crew_id
    WHEN 'luck' THEN 'الحظ' WHEN 'guide' THEN 'المرشد' WHEN 'sailor' THEN 'البحار'
    WHEN 'thief' THEN 'اللص' WHEN 'police' THEN 'الشرطي' WHEN 'trader' THEN 'التاجر'
    WHEN 'market_expert' THEN 'خبير الأسواق' WHEN 'fixer_1' THEN 'مصلح صغير'
    WHEN 'fixer_2' THEN 'مصلح متوسط' WHEN 'fixer_3' THEN 'مصلح كبير'
    WHEN 'fixer_4' THEN 'مصلح أسطوري' WHEN 'golden_fisher' THEN 'الصياد الذهبي'
    ELSE _crew_id END;

  IF _is_golden_fisher THEN
    SELECT golden_fisher_until INTO _gf_current FROM public.profiles WHERE id = _recipient_id;
    IF _gf_current IS NOT NULL AND _gf_current > now() THEN
      RAISE EXCEPTION 'recipient already has an active golden fisher';
    END IF;
  END IF;

  SELECT id, quantity INTO _inv_id, _crew_qty
  FROM public.inventory
  WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at, id LIMIT 1 FOR UPDATE;

  IF _inv_id IS NULL OR _crew_qty IS NULL OR _crew_qty < 1 THEN
    RAISE EXCEPTION 'sender has no such crew';
  END IF;

  IF _is_persistent THEN
    DELETE FROM public.inventory
    WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
      AND meta->>'assigned_ship_id' = _ship_id::text
      AND (meta->>'expires_at') IS NOT NULL
      AND (meta->>'expires_at')::timestamptz <= now();

    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN
      RAISE EXCEPTION 'recipient ship already has this crew';
    END IF;

    INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
    VALUES (_recipient_id, 'crew', _crew_id, 1,
            jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));

    _msg := 'طاقم: ' || _crew_id;
    _title := '👨‍✈️ أرسل لك طاقم دعم!';
    _body_action := 'أرسل طاقم ' || _crew_label || ' إلى سفينتك';
  ELSE
    DELETE FROM public.inventory
    WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
      AND (meta->>'expires_at') IS NOT NULL
      AND (meta->>'expires_at')::timestamptz <= now();

    IF _is_fixer_legendary THEN
      UPDATE public.ships_owned
         SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
       WHERE user_id = _recipient_id
         AND (destroyed_at IS NOT NULL OR COALESCE(hp,0) < COALESCE(max_hp,0));
      GET DIAGNOSTICS _affected = ROW_COUNT;
      _msg := 'مصلح أسطوري: أصلح كل السفن (' || _affected || ')';
      _title := '🛠️ مصلح أسطوري وصل!';
      _body_action := 'أصلح كل سفنك فورًا';
    ELSIF _is_fixer THEN
      UPDATE public.ships_owned
         SET hp = LEAST(max_hp, COALESCE(hp,0) + _heal),
             destroyed_at = CASE WHEN COALESCE(hp,0) + _heal >= max_hp THEN NULL ELSE destroyed_at END,
             repair_ends_at = CASE WHEN COALESCE(hp,0) + _heal >= max_hp THEN NULL ELSE repair_ends_at END
       WHERE id = _ship_id AND user_id = _recipient_id;
      _msg := 'مصلح: +' || _heal || ' HP';
      _title := '🛠️ أرسل لك مصلّح!';
      _body_action := 'أصلح سفينتك +' || _heal || ' HP';
    ELSIF _is_trader THEN
      SELECT ms.trader_until INTO _trader_ends FROM public.user_market_state ms WHERE ms.user_id = _recipient_id;
      IF _trader_ends IS NOT NULL AND _trader_ends > now() THEN
        RAISE EXCEPTION 'recipient already has active trader';
      END IF;
      INSERT INTO public.user_market_state(user_id, trader_until, updated_at)
      VALUES (_recipient_id, now() + interval '24 hours', now())
      ON CONFLICT (user_id) DO UPDATE
        SET trader_until = EXCLUDED.trader_until,
            trader_snapshot = '{}'::jsonb,
            trader_anchor = NULL,
            updated_at = now();
      _msg := 'تاجر: 24 ساعة';
      _title := '💰 أرسل لك تاجر!';
      _body_action := 'فعّل التاجر في سوق السمك لمدة 24 ساعة';
    ELSIF _is_market_expert THEN
      UPDATE public.profiles
         SET market_expert_until = GREATEST(COALESCE(market_expert_until, now()), now()) + interval '3 hours'
       WHERE id = _recipient_id;
      _msg := 'خبير الأسواق: 3 ساعات';
      _title := '📈 أرسل لك خبير الأسواق!';
      _body_action := 'فعّل خبير الأسواق لمدة 3 ساعات';
    ELSIF _is_golden_fisher THEN
      _gf_new_until := now() + interval '24 hours';
      UPDATE public.profiles
         SET golden_fisher_until = _gf_new_until,
             golden_fisher_last_activated_at = now(),
             golden_fisher_no_shield = true
       WHERE id = _recipient_id;
      _msg := 'الصياد الذهبي: 24 ساعة';
      _title := '🟡 أرسل لك الصياد الذهبي!';
      _body_action := 'فعّل الصياد الذهبي لمدة 24 ساعة';
    ELSE
      RAISE EXCEPTION 'unsupported crew support';
    END IF;
  END IF;

  IF _crew_qty = 1 THEN
    DELETE FROM public.inventory WHERE id = _inv_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
  END IF;

  INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
  VALUES (_me, _recipient_id, _ship_id, 'crew', 1, _msg, true);

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (_recipient_id, _title,
    _sender_emoji || ' ' || _sender_name || ' ' || _body_action, 'support', _me);
END
$function$;