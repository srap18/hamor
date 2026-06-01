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
  _is_trader boolean;
  _already_assigned int;
  _trader_ends timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  -- Gate: sender + recipient must both meet PvP/market requirements (mirrors attacks)
  -- Note: fishing ship requirement removed — sender can support without an active fishing ship
  IF NOT public.is_admin(_me) THEN
    IF NOT public.has_pvp_fleet(_me) THEN
      RAISE EXCEPTION 'sender needs pvp fleet: 3 ships of level 6 or higher';
    END IF;
    IF NOT public.is_market_pvp_unlocked(_recipient_id) THEN
      RAISE EXCEPTION 'recipient is a new player (market level under 6)';
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
  ELSE
    IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew id'; END IF;
    _is_fixer  := _crew_id IN ('fixer_1','fixer_2','fixer_3');
    _is_trader := _crew_id = 'trader';

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

    IF _is_fixer THEN
      UPDATE public.ships_owned
         SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
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
      SELECT count(*) INTO _already_assigned FROM public.inventory
        WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
          AND meta->>'assigned_ship_id' = _ship_id::text;
      IF _already_assigned > 0 THEN
        RAISE EXCEPTION 'recipient ship already has this crew';
      END IF;
      BEGIN
        INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
        VALUES (_recipient_id, 'crew', _crew_id, 1,
                jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.inventory
           SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
         WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
           AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
      END;
    END IF;

    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'crew', 0,
            CASE WHEN _is_trader THEN 'تاجر سوق لمدة 10 ساعات' ELSE 'طاقم: ' || _crew_id END, true);

    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id,
      CASE WHEN _is_trader THEN '💰 تاجر سوق وصلك!' ELSE '⚓ طاقم وصل سفينتك!' END,
      _sender_emoji || ' ' || _sender_name ||
      CASE WHEN _is_trader THEN ' أرسل لك تاجر سوق (10 ساعات)' ELSE ' أرسل لك طاقم: ' || _crew_id END,
      'support', _me);
  END IF;
END;
$function$;