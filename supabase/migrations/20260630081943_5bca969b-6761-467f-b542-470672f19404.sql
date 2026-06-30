
-- Close the self-update exploit on public.profiles:
-- Restrict the UPDATE grant to a whitelist of cosmetic / session columns.
-- All economic, progression, VIP, combat, skill and timer columns become
-- writable only via SECURITY DEFINER functions (and service_role).

REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;

GRANT UPDATE (
  display_name,
  avatar_emoji,
  avatar_url,
  avatar_frame,
  name_frame,
  bubble_frame,
  profile_frame,
  selected_bg_id,
  bio,
  album_privacy,
  ship_flag,
  elite_vip_login_broadcast_enabled,
  online_at,
  active_session_id,
  active_session_ip,
  active_session_ua,
  active_session_started_at
) ON public.profiles TO authenticated;

-- service_role keeps full access for server-side admin/maintenance code.
GRANT ALL ON public.profiles TO service_role;
