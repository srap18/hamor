
REVOKE SELECT (
  active_session_id, vip_expires_at, vip_subs_claimed, vip_points,
  protection_until, steal_blocked_until, bg_burned_until,
  golden_fisher_until, golden_fisher_last_activated_at, armor_last_bought_at,
  last_destroyer_id, last_destroyer_name, last_destroyer_kind,
  last_destroyer_at, last_destroyer_message,
  referral_code, referred_by, referral_locked_at,
  album_privacy, media_banned, username_changed_at
) ON public.profiles FROM anon;

REVOKE SELECT (
  stealing_target_user_id, stealing_target_ship_id, stealing_ends_at,
  fishing_started_at, last_fishing_reward_at
) ON public.ships_owned FROM anon;

DROP POLICY IF EXISTS adb_read_all ON public.ad_bombs;
CREATE POLICY adb_read_participants ON public.ad_bombs
  FOR SELECT TO authenticated
  USING (auth.uid() = attacker_id OR auth.uid() = target_user_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "destroyer messages public read" ON public.destroyer_messages;
CREATE POLICY destroyer_msg_participants ON public.destroyer_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = attacker_id OR auth.uid() = defender_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS bh_select_all ON public.boss_hits;
CREATE POLICY bh_select_authed ON public.boss_hits FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS as_select_all ON public.arena_scores;
CREATE POLICY as_select_authed ON public.arena_scores FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS td_select_all ON public.tribe_donations;
CREATE POLICY td_select_authed ON public.tribe_donations FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE(
  active_session_id text, vip_expires_at timestamptz, vip_subs_claimed int, vip_points int,
  protection_until timestamptz, steal_blocked_until timestamptz, bg_burned_until timestamptz,
  golden_fisher_until timestamptz, golden_fisher_last_activated_at timestamptz, armor_last_bought_at timestamptz,
  last_destroyer_id uuid, last_destroyer_name text, last_destroyer_kind text,
  last_destroyer_at timestamptz, last_destroyer_message text,
  referral_code text, referred_by uuid, referral_locked_at timestamptz,
  album_privacy text, media_banned boolean, username_changed_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.active_session_id, p.vip_expires_at, p.vip_subs_claimed, p.vip_points,
    p.protection_until, p.steal_blocked_until, p.bg_burned_until,
    p.golden_fisher_until, p.golden_fisher_last_activated_at, p.armor_last_bought_at,
    p.last_destroyer_id, p.last_destroyer_name, p.last_destroyer_kind,
    p.last_destroyer_at, p.last_destroyer_message,
    p.referral_code, p.referred_by, p.referral_locked_at,
    p.album_privacy, p.media_banned, p.username_changed_at
  FROM public.profiles p WHERE p.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.get_my_profile_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_ships_private()
RETURNS TABLE(
  id uuid, stealing_target_user_id uuid, stealing_target_ship_id uuid,
  stealing_ends_at timestamptz, fishing_started_at timestamptz, last_fishing_reward_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.stealing_target_user_id, s.stealing_target_ship_id,
    s.stealing_ends_at, s.fishing_started_at, s.last_fishing_reward_at
  FROM public.ships_owned s WHERE s.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.get_my_ships_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ships_private() TO authenticated;
