
-- 1) Session integrity: track IP + User-Agent
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_session_ip text,
  ADD COLUMN IF NOT EXISTS active_session_ua text,
  ADD COLUMN IF NOT EXISTS active_session_started_at timestamptz;

-- Revoke from anon (these are session-secrets)
REVOKE SELECT (active_session_ip, active_session_ua, active_session_started_at) ON public.profiles FROM anon;

-- Helper: extract client IP from PostgREST request headers
CREATE OR REPLACE FUNCTION public._client_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text;
BEGIN
  BEGIN
    h := current_setting('request.headers', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF h IS NULL OR h = '' THEN RETURN NULL; END IF;
  -- x-forwarded-for may be "ip1, ip2"; take the first
  RETURN split_part(coalesce((h::json->>'x-forwarded-for'), (h::json->>'cf-connecting-ip'), ''), ',', 1);
END;
$$;

CREATE OR REPLACE FUNCTION public._client_ua()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE h text;
BEGIN
  BEGIN h := current_setting('request.headers', true);
  EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  IF h IS NULL OR h = '' THEN RETURN NULL; END IF;
  RETURN left(coalesce(h::json->>'user-agent',''), 255);
END;
$$;

-- 2) Replace claim_session: stores IP/UA fingerprint at claim time
CREATE OR REPLACE FUNCTION public.claim_session(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF EXISTS (SELECT 1 FROM public.bans WHERE user_id = _uid AND (until IS NULL OR until > now())) THEN
    RAISE EXCEPTION 'banned';
  END IF;

  UPDATE public.profiles
     SET active_session_id = _token,
         active_session_ip = public._client_ip(),
         active_session_ua = public._client_ua(),
         active_session_started_at = now()
   WHERE id = _uid;
END;
$$;

-- 3) Session integrity check (called periodically by client).
--    If IP or UA changed mid-session, clear the session (kicks user) and flag.
--    NOTE: We allow IP changes within the same /24 subnet (mobile network roaming) to avoid false-positive kicks.
CREATE OR REPLACE FUNCTION public.verify_session_integrity(_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _cur_ip text := public._client_ip();
  _cur_ua text := public._client_ua();
  _ip_changed boolean := false;
  _ua_changed boolean := false;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;

  SELECT active_session_id, active_session_ip, active_session_ua
    INTO _row FROM public.profiles WHERE id = _uid;

  -- Different token already claimed → caller is stale
  IF _row.active_session_id IS DISTINCT FROM _token THEN
    RETURN false;
  END IF;

  -- IP fingerprint check: only flag if /16 prefix changed (carrier-friendly)
  IF _row.active_session_ip IS NOT NULL AND _cur_ip IS NOT NULL AND _cur_ip <> '' THEN
    IF split_part(_row.active_session_ip,'.',1) <> split_part(_cur_ip,'.',1)
       OR split_part(_row.active_session_ip,'.',2) <> split_part(_cur_ip,'.',2) THEN
      _ip_changed := true;
    END IF;
  END IF;

  -- UA must match exactly (browser/OS shouldn't change mid-session)
  IF _row.active_session_ua IS NOT NULL AND _cur_ua IS NOT NULL AND _row.active_session_ua <> _cur_ua THEN
    _ua_changed := true;
  END IF;

  IF _ip_changed OR _ua_changed THEN
    -- Kick: clear active session so the next realtime UPDATE forces sign-out
    UPDATE public.profiles
       SET active_session_id = NULL,
           active_session_ip = NULL,
           active_session_ua = NULL
     WHERE id = _uid;

    INSERT INTO public.cheat_flags (user_id, kind, severity, details)
    VALUES (_uid, 'session_hijack_suspected', 3,
            jsonb_build_object(
              'old_ip', _row.active_session_ip, 'new_ip', _cur_ip,
              'old_ua', left(coalesce(_row.active_session_ua,''),120),
              'new_ua', left(coalesce(_cur_ua,''),120),
              'ip_changed', _ip_changed, 'ua_changed', _ua_changed
            ));
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_session_integrity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_session_integrity(text) TO authenticated;

-- 4) Generic rate-limit guard. Returns NULL when OK, or milliseconds to wait.
--    Logs to cheat_flags only on repeated abuse (5+ violations / minute).
CREATE OR REPLACE FUNCTION public.rl_guard(_action text, _min_interval_ms integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _last timestamptz;
  _elapsed_ms integer;
  _violations integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _min_interval_ms < 50 OR _min_interval_ms > 60000 THEN
    _min_interval_ms := 500;
  END IF;

  SELECT last_at INTO _last
    FROM public.user_action_throttle
   WHERE user_id = _uid AND action = _action;

  IF _last IS NOT NULL THEN
    _elapsed_ms := floor(extract(epoch from (now() - _last)) * 1000)::int;
    IF _elapsed_ms < _min_interval_ms THEN
      -- Count recent violations for spam flag
      SELECT count(*) INTO _violations
        FROM public.cheat_flags
       WHERE user_id = _uid
         AND kind = 'rate_limit_violation'
         AND created_at > now() - interval '1 minute';
      IF _violations >= 4 THEN
        INSERT INTO public.cheat_flags (user_id, kind, severity, details)
        VALUES (_uid, 'rate_limit_spam', 2,
                jsonb_build_object('action', _action, 'recent_violations', _violations));
      ELSE
        INSERT INTO public.cheat_flags (user_id, kind, severity, details)
        VALUES (_uid, 'rate_limit_violation', 1,
                jsonb_build_object('action', _action, 'elapsed_ms', _elapsed_ms, 'min_ms', _min_interval_ms));
      END IF;
      RETURN _min_interval_ms - _elapsed_ms;
    END IF;
  END IF;

  INSERT INTO public.user_action_throttle (user_id, action, last_at)
  VALUES (_uid, _action, now())
  ON CONFLICT (user_id, action) DO UPDATE SET last_at = now();

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rl_guard(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rl_guard(text, integer) TO authenticated;

-- 5) Anti-tampering helper: client can report a suspected tamper attempt explicitly
CREATE OR REPLACE FUNCTION public.report_cheat(_kind text, _details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  IF _kind IS NULL OR length(_kind) > 64 THEN RETURN; END IF;
  INSERT INTO public.cheat_flags (user_id, kind, severity, details)
  VALUES (_uid, _kind, 1, coalesce(_details,'{}'::jsonb) || jsonb_build_object('ip', public._client_ip(), 'ua', left(coalesce(public._client_ua(),''),120)));
END;
$$;

REVOKE ALL ON FUNCTION public.report_cheat(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_cheat(text, jsonb) TO authenticated;
