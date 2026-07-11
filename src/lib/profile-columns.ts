// Safe profile columns readable by any authenticated user.
// Excludes session-fingerprint columns (active_session_id/ip/ua/started_at)
// which are revoked from the `authenticated` role at the column level.
// Use this instead of `select("*")` on the profiles table.
export const PROFILE_PUBLIC_COLUMNS =
  "id,display_name,avatar_emoji,level,xp,coins,gems,rubies,tribe_id,online_at,created_at,avatar_url,avatar_frame,name_frame,selected_bg_id,protection_until,steal_blocked_until,bubble_frame,profile_frame,vip_level,vip_points,vip_expires_at,vip_subs_claimed,bg_burned_until,armor_last_bought_at,last_destroyer_id,last_destroyer_name,last_destroyer_kind,last_destroyer_at,tribe_gems,username,username_changed_at,bio,media_banned,album_privacy,last_destroyer_message,ship_flag,weekly_xp,referral_code,referred_by,golden_fisher_until,golden_fisher_last_activated_at,golden_fisher_paused,elite_vip_level,elite_vip_expires_at,market_expert_until,friend_requests_closed";
