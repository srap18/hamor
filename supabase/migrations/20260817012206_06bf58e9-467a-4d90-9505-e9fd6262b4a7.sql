ALTER TABLE public.banned_phrase_hits ADD COLUMN IF NOT EXISTS context_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.guard_messages_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.allow_auto_sanction', true) = 'true' THEN RETURN OLD; END IF;
  IF public.is_privileged_caller() THEN RETURN OLD; END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF OLD.sender_id = auth.uid() OR public.is_admin(auth.uid()) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'not_authorized_to_delete' USING ERRCODE = '42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public._detect_banned_phrase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        INSERT INTO public.chat_mutes(user_id, reason, muted_by, active, expires_at, scope)
        VALUES (NEW.sender_id, 'كتابة عبارة ممنوعة: ' || _hit, NULL, true, now() + interval '7 days', 'both');
        _did_mute := true;
        PERFORM set_config('app.allow_auto_sanction', 'false', true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.allow_auto_sanction', 'false', true);
        _did_mute := false;
      END;
    END IF;
  END IF;

  -- snapshot conversation context before deleting anything
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

  -- delete the conversation (DM: whole thread between both; otherwise only the offending message)
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_banned_phrase_context(_hit_id uuid)
 RETURNS TABLE(id uuid, sender_id uuid, sender_name text, body text, channel text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  h public.banned_phrase_hits%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  SELECT * INTO h FROM public.banned_phrase_hits WHERE banned_phrase_hits.id = _hit_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF h.context_snapshot IS NOT NULL THEN
    RETURN QUERY
    SELECT (e->>'id')::uuid,
           (e->>'sender_id')::uuid,
           COALESCE(e->>'sender_name', 'غير معروف'),
           COALESCE(e->>'body', ''),
           e->>'channel',
           (e->>'created_at')::timestamptz
    FROM jsonb_array_elements(h.context_snapshot) e
    ORDER BY (e->>'created_at')::timestamptz ASC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT m.id, m.sender_id, COALESCE(p.display_name, 'غير معروف') AS sender_name,
           COALESCE(m.body, '') AS body, m.channel, m.created_at
    FROM public.messages m
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE m.created_at <= h.created_at
      AND (
        (h.channel = 'dm' AND h.peer_id IS NOT NULL AND m.channel = 'dm'
          AND ((m.sender_id = h.user_id AND m.recipient_id = h.peer_id)
            OR (m.sender_id = h.peer_id AND m.recipient_id = h.user_id)))
        OR (h.channel = 'tribe' AND m.channel = 'tribe' AND m.tribe_id IS NOT DISTINCT FROM h.tribe_id)
        OR (h.channel NOT IN ('dm','tribe') AND m.channel = h.channel)
      )
    ORDER BY m.created_at DESC
    LIMIT 10
  ) t
  ORDER BY t.created_at ASC;
END;
$function$;