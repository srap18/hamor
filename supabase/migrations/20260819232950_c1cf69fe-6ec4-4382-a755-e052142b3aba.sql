SELECT set_config('app.allow_auto_sanction', 'true', true);

ALTER TABLE public.chat_mutes ADD COLUMN IF NOT EXISTS message_body text;

UPDATE public.chat_mutes cm
SET message_body = (
  SELECT b.body FROM public.banned_phrase_hits b
  WHERE b.user_id = cm.user_id
    AND b.created_at BETWEEN cm.created_at - interval '2 minutes' AND cm.created_at + interval '2 minutes'
  ORDER BY abs(extract(epoch from (b.created_at - cm.created_at))) LIMIT 1
)
WHERE cm.message_body IS NULL AND cm.active;

UPDATE public.chat_mutes cm
SET message_body = (
  SELECT mr.message_body FROM public.message_reports mr
  WHERE mr.reported_user_id = cm.user_id
    AND mr.message_body IS NOT NULL AND btrim(mr.message_body) <> ''
    AND mr.created_at <= cm.created_at + interval '5 minutes'
  ORDER BY mr.created_at DESC LIMIT 1
)
WHERE cm.message_body IS NULL AND cm.active;

DELETE FROM public.chat_mutes WHERE active = false OR (expires_at IS NOT NULL AND expires_at <= now());

SELECT set_config('app.allow_auto_sanction', 'false', true);

CREATE OR REPLACE FUNCTION public._detect_banned_phrase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _hit text;
  _did_mute boolean := false;
  _snap jsonb;
BEGIN
  IF NEW.body IS NULL OR length(btrim(NEW.body)) = 0 THEN RETURN NEW; END IF;
  _hit := public.banned_phrase_match(NEW.body);
  IF _hit IS NULL THEN RETURN NEW; END IF;

  IF NOT public.is_admin(NEW.sender_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_mutes
      WHERE user_id = NEW.sender_id AND active = true
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      BEGIN
        PERFORM set_config('app.allow_auto_sanction', 'true', true);
        INSERT INTO public.chat_mutes(user_id, reason, muted_by, active, expires_at, scope, message_body)
        VALUES (NEW.sender_id, 'كتابة عبارة ممنوعة: ' || _hit, NULL, true, now() + interval '7 days', 'both', left(NEW.body, 500));
        _did_mute := true;
        PERFORM set_config('app.allow_auto_sanction', 'false', true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.allow_auto_sanction', 'false', true);
        _did_mute := false;
      END;
    END IF;
  END IF;

  BEGIN
    SELECT jsonb_agg(x ORDER BY (x->>'created_at'))
    INTO _snap
    FROM (
      SELECT jsonb_build_object(
               'id', m.id,
               'sender_id', m.sender_id,
               'sender_name', COALESCE(p.display_name, 'غير معروف'),
               'body', COALESCE(m.body, ''),
               'channel', m.channel,
               'created_at', m.created_at
             ) AS x
      FROM public.messages m
      LEFT JOIN public.profiles p ON p.id = m.sender_id
      WHERE m.created_at <= NEW.created_at
        AND (
          (NEW.channel = 'dm' AND NEW.recipient_id IS NOT NULL AND m.channel = 'dm'
            AND ((m.sender_id = NEW.sender_id AND m.recipient_id = NEW.recipient_id)
              OR (m.sender_id = NEW.recipient_id AND m.recipient_id = NEW.sender_id)))
          OR (NEW.channel = 'tribe' AND m.channel = 'tribe' AND m.tribe_id IS NOT DISTINCT FROM NEW.tribe_id)
          OR (NEW.channel NOT IN ('dm','tribe') AND m.channel = NEW.channel)
        )
      ORDER BY m.created_at DESC
      LIMIT 10
    ) s;
  EXCEPTION WHEN OTHERS THEN
    _snap := NULL;
  END;

  BEGIN
    INSERT INTO public.banned_phrase_hits(user_id, message_id, channel, peer_id, tribe_id, body, phrase, muted, context_snapshot)
    VALUES (NEW.sender_id, NEW.id, NEW.channel, NEW.recipient_id, NEW.tribe_id, NEW.body, _hit, _did_mute, _snap);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM set_config('app.allow_auto_sanction', 'true', true);
    IF NEW.channel = 'dm' AND NEW.recipient_id IS NOT NULL THEN
      DELETE FROM public.messages m
      WHERE m.channel = 'dm'
        AND ((m.sender_id = NEW.sender_id AND m.recipient_id = NEW.recipient_id)
          OR (m.sender_id = NEW.recipient_id AND m.recipient_id = NEW.sender_id));
    ELSE
      DELETE FROM public.messages m WHERE m.id = NEW.id;
    END IF;
    PERFORM set_config('app.allow_auto_sanction', 'false', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.allow_auto_sanction', 'false', true);
  END;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_lift_sanction(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid;
  v_affected int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'ban' THEN
    UPDATE public.bans SET active = false
      WHERE id = p_id AND active = true
      RETURNING user_id INTO v_target;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_target IS NOT NULL THEN
      DELETE FROM public.banned_devices WHERE user_id = v_target;
      DELETE FROM public.banned_ips WHERE user_id = v_target;
    END IF;
  ELSIF p_kind = 'mute' THEN
    PERFORM set_config('app.allow_auto_sanction', 'true', true);
    DELETE FROM public.chat_mute_devices WHERE mute_id = p_id;
    DELETE FROM public.chat_mute_ips WHERE mute_id = p_id;
    DELETE FROM public.chat_mutes WHERE id = p_id
      RETURNING user_id INTO v_target;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    DELETE FROM public.chat_mutes WHERE active = false OR (expires_at IS NOT NULL AND expires_at <= now());
    PERFORM set_config('app.allow_auto_sanction', 'false', true);
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  RETURN jsonb_build_object('ok', true, 'affected', v_affected, 'user_id', v_target);
END;
$fn$;