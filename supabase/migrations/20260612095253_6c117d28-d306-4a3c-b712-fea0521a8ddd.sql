
-- Hide session-fingerprint columns from cross-user reads. These columns are only
-- needed by server-side SECURITY DEFINER functions (claim_session,
-- verify_session_integrity) which run as the table owner and bypass column grants.
REVOKE SELECT (active_session_id, active_session_ip, active_session_ua, active_session_started_at)
  ON public.profiles FROM authenticated, anon;
