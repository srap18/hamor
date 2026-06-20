
-- Update the guard trigger to allow self-mute inserts coming from the auto-profanity flow
CREATE OR REPLACE FUNCTION public.guard_admin_only_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Allow profanity self-mutes (user muting themselves via send_chat_message_safe)
  IF TG_TABLE_NAME = 'chat_mutes'
     AND NEW.user_id = auth.uid()
     AND NEW.muted_by = auth.uid()
     AND NEW.reason LIKE 'profanity:%' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

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
  _matched text;
  _warn_count int;
  _mute_count int;
  _mute_hours int;
  _expires timestamptz;
  _msg_id uuid;
  _body text := btrim(COALESCE(_body, ''));
  _mute_reason text;
  _mute_expires timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body) = 0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body) > 500 THEN _body := left(_body, 500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  -- Reject when sender is currently muted
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
      'reason', COALESCE(_mute_reason, 'muted'),
      'expires_at', _mute_expires,
      'message', 'أنت مكتوم حالياً'
    );
  END IF;

  _matched := public.check_profanity(_body);

  IF _matched IS NOT NULL THEN
    INSERT INTO public.profanity_warnings(user_id, body, matched_word)
    VALUES (_uid, _body, _matched);

    SELECT count(*) INTO _warn_count
    FROM public.profanity_warnings
    WHERE user_id = _uid AND created_at > now() - interval '24 hours';

    IF _warn_count < 3 THEN
      RETURN jsonb_build_object(
        'status', 'warned',
        'warn_count', _warn_count,
        'remaining', 3 - _warn_count,
        'message', 'تحذير ' || _warn_count || '/2 — ممنوع السب والشتم. تكرار المخالفة سيؤدي للكتم.'
      );
    END IF;

    SELECT count(*) INTO _mute_count
    FROM public.chat_mutes
    WHERE user_id = _uid AND reason LIKE 'profanity%';

    _mute_hours := CASE _mute_count
      WHEN 0 THEN 1
      WHEN 1 THEN 6
      WHEN 2 THEN 12
      WHEN 3 THEN 24
      WHEN 4 THEN 48
      ELSE 168
    END;
    _expires := now() + make_interval(hours => _mute_hours);

    UPDATE public.chat_mutes SET active = false
     WHERE user_id = _uid AND active = true;

    INSERT INTO public.chat_mutes(user_id, reason, expires_at, active, muted_by)
    VALUES (_uid, 'profanity:' || _matched, _expires, true, _uid);

    RETURN jsonb_build_object(
      'status', 'muted',
      'hours', _mute_hours,
      'expires_at', _expires,
      'message', 'تم كتمك ' || _mute_hours || ' ساعة بسبب تكرار السب.'
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

REVOKE EXECUTE ON FUNCTION public.send_chat_message_safe(text, text, uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_chat_message_safe(text, text, uuid, uuid, uuid, text, text) TO authenticated;
