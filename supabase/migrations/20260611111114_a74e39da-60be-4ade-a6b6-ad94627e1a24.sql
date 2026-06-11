-- Fix bug: claim_session referenced non-existent column bans.until; should be expires_at + active flag.
CREATE OR REPLACE FUNCTION public.claim_session(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bans
    WHERE user_id = _uid
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'banned';
  END IF;

  UPDATE public.profiles
     SET active_session_id = _token,
         active_session_ip = public._client_ip(),
         active_session_ua = public._client_ua(),
         active_session_started_at = now()
   WHERE id = _uid;
END;
$function$;