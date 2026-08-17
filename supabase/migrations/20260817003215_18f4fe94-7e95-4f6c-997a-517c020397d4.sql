CREATE OR REPLACE FUNCTION public._detect_banned_phrase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _hit text;
  _did_mute boolean := false;
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

  BEGIN
    INSERT INTO public.banned_phrase_hits(user_id, message_id, channel, peer_id, tribe_id, body, phrase, muted)
    VALUES (NEW.sender_id, NEW.id, NEW.channel, NEW.recipient_id, NEW.tribe_id, NEW.body, _hit, _did_mute);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$function$;