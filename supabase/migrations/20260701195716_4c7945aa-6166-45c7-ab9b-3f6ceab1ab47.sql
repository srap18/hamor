-- Tribe join request: safe RPC that avoids duplicate-key errors and stale requests.
CREATE OR REPLACE FUNCTION public.request_join_tribe(_tribe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_mode text;
  v_request_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT tribe_id INTO v_existing FROM public.profiles WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.tribe_join_requests WHERE user_id = v_uid AND status = 'pending';
    RETURN jsonb_build_object('status', 'already_in_tribe');
  END IF;

  SELECT join_mode INTO v_mode FROM public.tribes WHERE id = _tribe_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'tribe not found';
  END IF;
  IF v_mode = 'open' THEN
    RETURN jsonb_build_object('status', 'open_tribe');
  END IF;

  DELETE FROM public.tribe_join_requests
  WHERE tribe_id = _tribe_id AND user_id = v_uid;

  INSERT INTO public.tribe_join_requests(tribe_id, user_id, status)
  VALUES (_tribe_id, v_uid, 'pending')
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('status', 'sent', 'request_id', v_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_join_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tribe uuid;
  v_user uuid;
  v_status text;
  v_current_tribe uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tribe_id, user_id, status INTO v_tribe, v_user, v_status
  FROM public.tribe_join_requests WHERE id = _request_id;
  IF v_tribe IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'request not pending'; END IF;
  IF NOT public.is_tribe_officer(v_uid, v_tribe) THEN
    RAISE EXCEPTION 'not an officer';
  END IF;

  SELECT tribe_id INTO v_current_tribe FROM public.profiles WHERE id = v_user;
  IF v_current_tribe IS NOT NULL THEN
    UPDATE public.tribe_join_requests SET status = 'rejected' WHERE id = _request_id;
    DELETE FROM public.tribe_join_requests WHERE user_id = v_user AND status = 'pending';
    RAISE EXCEPTION 'user already in a tribe';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tribe_members WHERE user_id = v_user) THEN
    UPDATE public.tribe_join_requests SET status = 'rejected' WHERE id = _request_id;
    DELETE FROM public.tribe_join_requests WHERE user_id = v_user AND status = 'pending';
    RAISE EXCEPTION 'user already in a tribe';
  END IF;

  INSERT INTO public.tribe_members(tribe_id, user_id, role) VALUES (v_tribe, v_user, 'member')
    ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET tribe_id = v_tribe WHERE id = v_user;
  UPDATE public.tribe_join_requests SET status = 'accepted' WHERE id = _request_id;

  DELETE FROM public.tribe_join_requests
  WHERE user_id = v_user AND id <> _request_id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.join_tribe_open(_tribe_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mode text;
  v_uid uuid := auth.uid();
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT join_mode INTO v_mode FROM public.tribes WHERE id = _tribe_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'tribe not found';
  END IF;
  IF v_mode <> 'open' THEN
    RAISE EXCEPTION 'tribe requires request';
  END IF;

  SELECT tribe_id INTO v_existing FROM public.profiles WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.tribe_join_requests WHERE user_id = v_uid AND status = 'pending';
    IF v_existing = _tribe_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'already in a tribe';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tribe_members WHERE user_id = v_uid) THEN
    DELETE FROM public.tribe_join_requests WHERE user_id = v_uid AND status = 'pending';
    RAISE EXCEPTION 'already in a tribe';
  END IF;

  INSERT INTO public.tribe_members(tribe_id, user_id, role) VALUES (_tribe_id, v_uid, 'member');
  UPDATE public.profiles SET tribe_id = _tribe_id WHERE id = v_uid;
  DELETE FROM public.tribe_join_requests WHERE user_id = v_uid AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friends f
    WHERE f.status = 'accepted'
      AND ((_a = f.requester_id AND _b = f.addressee_id) OR (_a = f.addressee_id AND _b = f.requester_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.send_chat_message_safe(_channel text, _body text, _recipient_id uuid DEFAULT NULL::uuid, _tribe_id uuid DEFAULT NULL::uuid, _reply_to_id uuid DEFAULT NULL::uuid, _reply_to_body text DEFAULT NULL::text, _reply_to_name text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg_id uuid;
  _body text := btrim(COALESCE(_body, ''));
  _mute_reason text;
  _mute_expires timestamptz;
  _mlevel int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body) = 0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body) > 500 THEN _body := left(_body, 500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'moderator')) THEN
    SELECT COALESCE(level, 1) INTO _mlevel FROM public.user_market WHERE user_id = _uid;
    IF COALESCE(_mlevel, 1) < 6 THEN
      RETURN jsonb_build_object(
        'status', 'level_locked',
        'required_level', 6,
        'current_level', COALESCE(_mlevel, 1),
        'message', 'لا تقدر ترسل في الشات إلا بعد وصول سوق السفن للمستوى 6'
      );
    END IF;
  END IF;

  SELECT reason, expires_at INTO _mute_reason, _mute_expires
  FROM public.chat_mutes
  WHERE user_id = _uid
    AND active = true
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT cmd.reason, cmd.expires_at INTO _mute_reason, _mute_expires
    FROM public.chat_mute_devices cmd
    JOIN public.device_accounts da ON da.device_id = cmd.device_id
    WHERE da.user_id = _uid
      AND cmd.active = true
      AND (cmd.expires_at IS NULL OR cmd.expires_at > now())
    ORDER BY cmd.created_at DESC
    LIMIT 1;
  END IF;

  IF _mute_reason IS NULL AND _mute_expires IS NULL THEN
    SELECT cmi.reason, cmi.expires_at INTO _mute_reason, _mute_expires
    FROM public.chat_mute_ips cmi
    JOIN public.user_ips ui ON ui.ip = cmi.ip
    WHERE ui.user_id = _uid
      AND cmi.active = true
      AND (cmi.expires_at IS NULL OR cmi.expires_at > now())
    ORDER BY cmi.created_at DESC
    LIMIT 1;
  END IF;

  IF _mute_reason IS NOT NULL OR _mute_expires IS NOT NULL OR public.is_muted(_uid) THEN
    RETURN jsonb_build_object(
      'status', 'muted_already',
      'reason', COALESCE(_mute_reason, ''),
      'expires_at', _mute_expires,
      'message', 'أنت مكتوم حالياً'
    );
  END IF;

  IF _channel = 'tribe' THEN
    IF _tribe_id IS NULL OR NOT public.is_tribe_member(_uid, _tribe_id) THEN
      RAISE EXCEPTION 'not tribe member';
    END IF;
  ELSIF _channel = 'dm' THEN
    IF _recipient_id IS NULL OR _recipient_id = _uid THEN
      RAISE EXCEPTION 'bad recipient';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _uid AND blocked_id = _recipient_id)
         OR (blocker_id = _recipient_id AND blocked_id = _uid)
    ) THEN
      RAISE EXCEPTION 'blocked';
    END IF;
    IF NOT public.are_friends(_uid, _recipient_id) THEN
      RAISE EXCEPTION 'dm requires friendship';
    END IF;
  END IF;

  INSERT INTO public.messages(channel, body, sender_id, recipient_id, tribe_id,
                              reply_to_id, reply_to_body, reply_to_name)
  VALUES (_channel, _body, _uid,
          CASE WHEN _channel='dm' THEN _recipient_id ELSE NULL END,
          CASE WHEN _channel='tribe' THEN _tribe_id ELSE NULL END,
          _reply_to_id,
          left(COALESCE(_reply_to_body,''), 200),
          left(COALESCE(_reply_to_name,''), 60))
  RETURNING id INTO _msg_id;

  RETURN jsonb_build_object('status', 'sent', 'id', _msg_id, 'message_id', _msg_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_market_upgrades()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.user_market
  SET level = GREATEST(level, upgrading_to),
      upgrading_to = NULL,
      upgrade_started_at = NULL,
      upgrade_ends_at = NULL,
      upgrade_cost_coins = NULL,
      updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL
    AND upgrade_ends_at <= now() + interval '10 seconds'
    AND upgrading_to IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.finalize_fish_market_upgrades()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.user_fish_market
  SET level = GREATEST(level, upgrading_to),
      upgrading_to = NULL,
      upgrade_started_at = NULL,
      upgrade_ends_at = NULL,
      upgrade_cost_coins = NULL,
      updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL
    AND upgrade_ends_at <= now() + interval '10 seconds'
    AND upgrading_to IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.market_finish_upgrade_with_gems()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := CASE WHEN _secs_left <= 10 THEN 0 ELSE GREATEST(1, CEIL(_secs_left::numeric / 60))::int END;
  IF _gems > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  END IF;
  UPDATE public.user_market
    SET level = GREATEST(level, upgrading_to),
        upgrading_to = NULL,
        upgrade_started_at = NULL,
        upgrade_ends_at = NULL,
        upgrade_cost_coins = NULL,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN _gems;
END $$;

CREATE OR REPLACE FUNCTION public.fish_market_finish_upgrade_with_gems()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := CASE WHEN _secs_left <= 10 THEN 0 ELSE GREATEST(1, CEIL(_secs_left::numeric / 60))::int END;
  IF _gems > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  END IF;
  UPDATE public.user_fish_market
    SET level = GREATEST(level, upgrading_to),
        upgrading_to = NULL,
        upgrade_started_at = NULL,
        upgrade_ends_at = NULL,
        upgrade_cost_coins = NULL,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN _gems;
END $$;

-- Clean existing stale rows.
UPDATE public.tribe_join_requests r
SET status = 'rejected'
WHERE r.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = r.user_id AND p.tribe_id IS NOT NULL
  );

DELETE FROM public.tribe_join_requests r
WHERE r.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.tribe_members m
    WHERE m.user_id = r.user_id
  );

UPDATE public.user_market
SET level = GREATEST(level, upgrading_to),
    upgrading_to = NULL,
    upgrade_started_at = NULL,
    upgrade_ends_at = NULL,
    upgrade_cost_coins = NULL,
    updated_at = now()
WHERE upgrading_to IS NOT NULL
  AND upgrade_ends_at <= now() + interval '10 seconds';

UPDATE public.user_fish_market
SET level = GREATEST(level, upgrading_to),
    upgrading_to = NULL,
    upgrade_started_at = NULL,
    upgrade_ends_at = NULL,
    upgrade_cost_coins = NULL,
    updated_at = now()
WHERE upgrading_to IS NOT NULL
  AND upgrade_ends_at <= now() + interval '10 seconds';