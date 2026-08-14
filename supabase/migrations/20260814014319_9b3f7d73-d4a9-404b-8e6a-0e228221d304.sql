CREATE OR REPLACE FUNCTION public.get_my_active_session_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.active_session_id FROM public.profiles p WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_active_session_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_session_id() TO authenticated;

REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (
  id, display_name, avatar_emoji, level, xp, coins, gems, rubies, tribe_id, online_at,
  created_at, avatar_url, avatar_frame, name_frame, selected_bg_id, protection_until,
  steal_blocked_until, bubble_frame, profile_frame, vip_level, vip_points, vip_expires_at,
  vip_subs_claimed, bg_burned_until, armor_last_bought_at, last_destroyer_id,
  last_destroyer_name, last_destroyer_kind, last_destroyer_at, tribe_gems, username,
  username_changed_at, bio, media_banned, album_privacy, last_destroyer_message, ship_flag,
  weekly_xp, referral_code, referred_by, golden_fisher_until, golden_fisher_last_activated_at,
  elite_vip_level, elite_vip_expires_at, xp_today, skill_points, skill_str, skill_def,
  skill_luck, skill_fish, skill_speed, elite_vip_login_broadcast_enabled, market_expert_until,
  golden_fisher_paused, reports_disabled, total_damage_dealt, friend_requests_closed,
  display_name_changed_at, storage_capacity, free_name_change_available,
  chat_audio_upload_allowed, tutorial_completed, trade_allowed
) ON public.profiles TO authenticated;