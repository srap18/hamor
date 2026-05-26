
-- Crews: unified 24h assigned-to-ship model when sent to other players + active for thief/police via assignment

-- 1) send_support: when sending a crew, consume from sender and assign it for 24h to target ship in recipient inventory.
--    For fixer crews: also instant-repair the target ship.
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
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

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
    _is_fixer := _crew_id IN ('fixer_1','fixer_2','fixer_3');

    -- Consume one from sender
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

    -- Insert an assigned-to-ship 24h buff row directly in recipient's inventory
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
    VALUES (_recipient_id, 'crew', _crew_id, 1,
            jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', to_char(_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'gifted_by', _me::text));

    -- Fixer crews also instant-repair the ship
    IF _is_fixer THEN
      UPDATE public.ships_owned
         SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
       WHERE id = _ship_id;
    END IF;

    _msg := 'طاقم: ' || _crew_id || ' (24 ساعة على السفينة)';
    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'crew', 0, _msg, true);

    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id, '👨‍✈️ وصلك طاقم دعم!',
      _sender_emoji || ' ' || _sender_name || ' فعّل لك طاقم (' || _crew_id || ') على سفينتك لمدة 24 ساعة'
      || CASE WHEN _is_fixer THEN ' — وأصلح السفينة بالكامل' ELSE '' END,
      'support', _me);
  END IF;
END;
$function$;

-- 2) start_steal_mission: check ASSIGNED & active thief/police crews instead of consuming.
--    Assigned = inventory row with meta.assigned_ship_id set and (no expires_at OR expires_at > now()).
CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
 RETURNS TABLE(ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _prot timestamptz;
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
  _bypass boolean := false;
  _has_police boolean;
  _has_thief boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id AND user_id = _me
     AND stealing_target_user_id IS NOT NULL
     AND stealing_ends_at IS NOT NULL
     AND stealing_ends_at <= now();

  SELECT steal_blocked_until INTO _blk FROM public.profiles WHERE id = _me;
  IF _blk IS NOT NULL AND _blk > now() THEN
    RAISE EXCEPTION 'thief blocked until %', _blk;
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF NOT FOUND THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'ship is destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'ship is busy at sea'; END IF;
  IF _my_ship.repair_ends_at IS NOT NULL AND _my_ship.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF _their_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'target ship destroyed'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL
     OR _their_ship.stealing_target_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'target not fishing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE stealing_target_ship_id = _target_ship_id
       AND stealing_ends_at IS NOT NULL
       AND stealing_ends_at > now()
  ) THEN
    RAISE EXCEPTION 'target ship already being raided';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  -- POLICE: target has an ACTIVE assigned police crew on any ship
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _target_user_id
       AND item_type = 'crew' AND item_id = 'police' AND quantity > 0
       AND meta ? 'assigned_ship_id'
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_police;

  IF _has_police THEN
    -- THIEF: attacker has an ACTIVE assigned thief crew → 80% bypass
    SELECT EXISTS (
      SELECT 1 FROM public.inventory
       WHERE user_id = _me
         AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
         AND meta ? 'assigned_ship_id'
         AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) INTO _has_thief;

    IF _has_thief THEN
      _bypass := (random() < 0.8);
    END IF;

    IF NOT _bypass THEN
      UPDATE public.profiles SET steal_blocked_until = now() + interval '1 hour' WHERE id = _me;
      INSERT INTO public.notifications (recipient_id, title, body, kind)
      VALUES
        (_me, '👮 قبض عليك!', 'شرطي الخصم قبض عليك — ممنوع من السرقة ساعة', 'warning'),
        (_target_user_id, '👮 شرطيك قبض على لص!', 'شرطيك أمسك لصاً يحاول سرقتك', 'success');
      RAISE EXCEPTION 'caught by police';
    END IF;
  END IF;

  SELECT COALESCE(sc.fishing_seconds, 30) INTO _secs
  FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
  IF _secs IS NULL OR _secs < 5 THEN _secs := 30; END IF;

  -- THIEF bonus: 40% faster steal when active
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _me
       AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
       AND meta ? 'assigned_ship_id'
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_thief;
  IF _has_thief THEN
    _secs := GREATEST(5, (_secs * 6 / 10));
  END IF;

  _ends := now() + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = now(),
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _ends;
END;
$function$;
