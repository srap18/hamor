CREATE OR REPLACE FUNCTION public.verify_session_integrity(_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _cur_ua text := public._client_ua();
  _ua_changed boolean := false;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;

  SELECT active_session_id, active_session_ip, active_session_ua
    INTO _row FROM public.profiles WHERE id = _uid;

  -- Different token already claimed → caller is stale
  IF _row.active_session_id IS DISTINCT FROM _token THEN
    RETURN false;
  END IF;

  -- IP check disabled: mobile carriers rotate IPs frequently (CGNAT, tower
  -- handoff, Wi-Fi ↔ cellular). Kicking on IP change caused mass false
  -- sign-outs. Real session theft would also change the UA.

  -- UA must match exactly (browser/OS shouldn't change mid-session).
  -- Allow legitimate browser auto-updates by comparing only the platform
  -- prefix up to the first " Version/" or " Chrome/" segment.
  IF _row.active_session_ua IS NOT NULL AND _cur_ua IS NOT NULL
     AND _row.active_session_ua <> _cur_ua THEN
    -- Compare the first 60 chars (platform + engine) — ignores Chrome/Safari
    -- minor version bumps that happen automatically.
    IF left(_row.active_session_ua, 60) <> left(_cur_ua, 60) THEN
      _ua_changed := true;
    END IF;
  END IF;

  IF _ua_changed THEN
    UPDATE public.profiles
       SET active_session_id = NULL,
           active_session_ip = NULL,
           active_session_ua = NULL
     WHERE id = _uid;

    INSERT INTO public.cheat_flags (user_id, kind, severity, details)
    VALUES (_uid, 'session_hijack_suspected', 3,
            jsonb_build_object(
              'old_ua', left(coalesce(_row.active_session_ua,''),120),
              'new_ua', left(coalesce(_cur_ua,''),120),
              'ua_changed', true
            ));
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_session_integrity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_session_integrity(text) TO authenticated;