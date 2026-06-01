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
  _crew_qty int;
  _msg text;
  _expires timestamptz := now() + interval '24 hours';
  _is_fixer boolean;
  _is_fixer_legendary boolean;
  _is_trader boolean;
  _is_persistent boolean;
  _heal int;
  _already_assigned int;
  _trader_ends timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

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

  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id;
  IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
    RAISE EXCEPTION 'target ship does not belong to recipient';
  END IF;

  IF _kind = 'repair' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE id = _ship_id;
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

  -- For persistent crews, pre-check that recipient doesn't already have it assigned to that ship
  IF _is_persistent THEN
    SELECT count(*) INTO _already_assigned FROM public.inventory
      WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text;
    IF _already_assigned > 0 THEN
      RAISE EXCEPTION 'recipient ship already has this crew';
    END IF;
  END IF;

  -- Consume one from sender's unassigned inventory
  SELECT quantity INTO _crew_qty FROM public.inventory
    WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
      AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
    FOR UPDATE;
  IF _crew_qty IS NULL OR _crew_qty < 1 THEN RAISE EXCEPTION 'sender has no such crew'; END IF;
  IF _crew_qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
      AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
  END IF;

  IF _is_fixer_legendary THEN
    -- Fully repair ALL recipient's ships
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE user_id = _recipient_id;
  ELSIF _is_fixer THEN
    -- Heal fixed amount on the targeted ship, capped at max_hp
    UPDATE public.ships_owned
       SET hp = LEAST(max_hp, GREATEST(0, COALESCE(hp,0)) + _heal),
           destroyed_at = CASE WHEN COALESCE(hp,0) + _heal > 0 THEN NULL ELSE destroyed_at END,
           repair_ends_at = CASE WHEN LEAST(max_hp, COALESCE(hp,0) + _heal) >= max_hp THEN NULL ELSE repair_ends_at END
     WHERE id = _ship_id;
  ELSIF _is_trader THEN
    _trader_ends := now() + interval '10 hours';
    INSERT INTO public.user_market_state(user_id, trader_until)
      VALUES (_recipient_id, _trader_ends)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(
            COALESCE(public.user_market_state.trader_until, now()),
            EXCLUDED.trader_until),
          updated_at = now();
  ELSE
    -- Persistent crew → assign to recipient's ship for 24h
    BEGIN
      INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
      VALUES (_recipient_id, 'crew', _crew_id, 1,
              jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.inventory
         SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
       WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
         AND meta->>'assigned_ship_id' = _ship_id::text;
    END;
  END IF;

  INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
  VALUES (_me, _recipient_id, _ship_id, 'crew', 0,
          CASE
            WHEN _is_trader THEN 'تاجر سوق لمدة 10 ساعات'
            WHEN _is_fixer_legendary THEN 'مصلح أسطوري: تعبئة جميع السفن'
            WHEN _is_fixer THEN 'مصلح: +' || _heal || ' دم'
            ELSE 'طاقم: ' || _crew_id
          END, true);

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (_recipient_id,
    CASE
      WHEN _is_trader THEN '💰 تاجر سوق وصلك!'
      WHEN _is_fixer_legendary THEN '🏆 مصلح أسطوري عبّى أسطولك!'
      WHEN _is_fixer THEN '🛠️ مصلح أصلح سفينتك!'
      ELSE '⚓ طاقم وصل سفينتك!'
    END,
    _sender_emoji || ' ' || _sender_name ||
    CASE
      WHEN _is_trader THEN ' أرسل لك تاجر سوق (10 ساعات)'
      WHEN _is_fixer_legendary THEN ' عبّى لك كل السفن بالكامل'
      WHEN _is_fixer THEN ' أصلح سفينتك (+' || _heal || ' دم)'
      ELSE ' أرسل لك طاقم: ' || _crew_id
    END,
    'support', _me);
END;
$function$;