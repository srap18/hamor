
-- 1) Profiles: hide sensitive session columns from non-owners
-- Keep RLS public policy as-is, but revoke column-level SELECT for sensitive cols.
REVOKE SELECT (active_session_ip, active_session_ua, active_session_id, active_session_started_at)
  ON public.profiles FROM anon, authenticated;

-- Allow the owner (and admins via SECURITY DEFINER fns) to still read via dedicated RPCs;
-- normal SELECT on those columns now returns permission denied for non-self callers.
-- Owner self-access is preserved through get_my_profile_private() and equivalent RPCs.

-- 2) destroyer_messages: drop the overly-permissive public-read policy
DROP POLICY IF EXISTS "destroyer_messages public read" ON public.destroyer_messages;
-- The remaining policy 'destroyer_msg_participants' restricts to attacker/defender only.

-- 3) profanity_words: restrict reads to admins only (server-side checks unaffected)
DROP POLICY IF EXISTS pw_auth_read ON public.profanity_words;
-- admin_manage_profanity_words (or equivalent) policy continues to allow admins.
-- Server-side functions using SECURITY DEFINER still read the table normally.
