-- Private session metadata (never exposed to clients)
CREATE TABLE IF NOT EXISTS public.player_sessions (
  user_id uuid PRIMARY KEY,
  ip text,
  ua text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.player_sessions TO service_role;
ALTER TABLE public.player_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_sessions_admin_read"
ON public.player_sessions FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Move existing data out of the public profiles table
INSERT INTO public.player_sessions (user_id, ip, ua, started_at, updated_at)
SELECT id, active_session_ip, active_session_ua,
       COALESCE(active_session_started_at, now()), now()
FROM public.profiles
WHERE active_session_ip IS NOT NULL OR active_session_ua IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET ip = EXCLUDED.ip, ua = EXCLUDED.ua, updated_at = now();

UPDATE public.profiles
   SET active_session_ip = NULL, active_session_ua = NULL
 WHERE active_session_ip IS NOT NULL OR active_session_ua IS NOT NULL;

-- claim_session now records IP/UA privately
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
         active_session_ip = NULL,
         active_session_ua = NULL,
         active_session_started_at = now()
   WHERE id = _uid;

  INSERT INTO public.player_sessions (user_id, ip, ua, started_at, updated_at)
  VALUES (_uid, public._client_ip(), public._client_ua(), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET ip = EXCLUDED.ip, ua = EXCLUDED.ua, started_at = now(), updated_at = now();
END;
$function$;

-- verify_session_integrity reads the private table
CREATE OR REPLACE FUNCTION public.verify_session_integrity(_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _session_id text;
  _stored_ua text;
  _cur_ua text := public._client_ua();
  _ua_changed boolean := false;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;

  SELECT active_session_id INTO _session_id FROM public.profiles WHERE id = _uid;
  IF _session_id IS DISTINCT FROM _token THEN
    RETURN false;
  END IF;

  SELECT ua INTO _stored_ua FROM public.player_sessions WHERE user_id = _uid;

  -- IP check stays disabled: mobile carriers rotate IPs frequently.
  IF _stored_ua IS NOT NULL AND _cur_ua IS NOT NULL AND _stored_ua <> _cur_ua THEN
    IF left(_stored_ua, 60) <> left(_cur_ua, 60) THEN
      _ua_changed := true;
    END IF;
  END IF;

  IF _ua_changed THEN
    UPDATE public.profiles SET active_session_id = NULL WHERE id = _uid;
    UPDATE public.player_sessions SET ip = NULL, ua = NULL, updated_at = now() WHERE user_id = _uid;

    INSERT INTO public.cheat_flags (user_id, kind, severity, details)
    VALUES (_uid, 'session_hijack_suspected', 3,
            jsonb_build_object(
              'old_ua', left(coalesce(_stored_ua,''),120),
              'new_ua', left(coalesce(_cur_ua,''),120),
              'ua_changed', true
            ));
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;