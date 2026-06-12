-- 1) Clean slate: revoke ALL table-level grants on profiles from regular users.
REVOKE ALL ON public.profiles FROM anon, authenticated, public;

-- 2) Grant SELECT only on safe public columns to authenticated users.
--    Excludes: active_session_id, active_session_ip, active_session_ua, active_session_started_at.
GRANT SELECT (
  id, display_name, avatar_emoji, level, xp, coins, gems, rubies, tribe_id,
  online_at, created_at, avatar_url, avatar_frame, name_frame, selected_bg_id,
  protection_until, steal_blocked_until, bubble_frame, profile_frame,
  vip_level, vip_points, vip_expires_at, vip_subs_claimed, bg_burned_until,
  armor_last_bought_at, last_destroyer_id, last_destroyer_name,
  last_destroyer_kind, last_destroyer_at, tribe_gems, username,
  username_changed_at, bio, media_banned, album_privacy, last_destroyer_message,
  ship_flag, weekly_xp, referral_code, referred_by, referral_locked_at,
  golden_fisher_until, golden_fisher_last_activated_at, elite_vip_level,
  elite_vip_expires_at
) ON public.profiles TO authenticated;

-- 3) Grant UPDATE only on cosmetic columns the user is allowed to change directly.
--    Everything else (currency, xp, level, vip, protection, sessions, tribe, etc.)
--    must be updated by SECURITY DEFINER functions or the service role.
GRANT UPDATE (
  display_name, bio, avatar_emoji, avatar_url, avatar_frame, name_frame,
  bubble_frame, profile_frame, album_privacy, selected_bg_id
) ON public.profiles TO authenticated;

-- 4) Service role keeps full power for trusted server-side code.
GRANT ALL ON public.profiles TO service_role;

-- 5) Tighten the update policy with a matching WITH CHECK so the row id can
--    never be changed and updates are strictly scoped to the signed-in user.
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 6) Make sure no INSERT/DELETE policies exist for clients. Profiles are
--    created by the signup trigger and deleted only by the service role.
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_self ON public.profiles;