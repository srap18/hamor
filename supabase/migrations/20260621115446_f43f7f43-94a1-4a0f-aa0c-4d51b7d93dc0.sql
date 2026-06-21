
CREATE OR REPLACE FUNCTION public.send_chat_message_safe(
  _channel text,
  _body text,
  _recipient_id uuid DEFAULT NULL,
  _tribe_id uuid DEFAULT NULL,
  _reply_to_id uuid DEFAULT NULL,
  _reply_to_body text DEFAULT NULL,
  _reply_to_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Minimum ship-market level requirement (admins/moderators bypass)
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

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'muted_already',
      'reason', _mute_reason,
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
