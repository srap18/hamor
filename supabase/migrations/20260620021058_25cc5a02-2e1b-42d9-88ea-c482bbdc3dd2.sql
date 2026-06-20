
CREATE OR REPLACE FUNCTION public.admin_hard_delete_user(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;
  IF auth.uid() IS NOT NULL AND _uid = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_DELETE_SELF';
  END IF;

  -- Disable per-row guards that would block full account wipe
  SET LOCAL session_replication_role = 'replica';

  DELETE FROM public.attacks WHERE attacker_id = _uid OR defender_id = _uid;
  DELETE FROM public.destroyer_messages WHERE attacker_id = _uid OR defender_id = _uid;
  DELETE FROM public.global_last_attack WHERE attacker_id = _uid OR target_id = _uid;
  DELETE FROM public.ad_bombs WHERE target_user_id = _uid;
  DELETE FROM public.arena_scores WHERE user_id = _uid;
  DELETE FROM public.boss_attack_quota WHERE user_id = _uid;
  DELETE FROM public.boss_hits WHERE user_id = _uid;
  DELETE FROM public.bot_action_log WHERE user_id = _uid;
  DELETE FROM public.cheat_flags WHERE user_id = _uid;

  DELETE FROM public.inventory WHERE user_id = _uid;
  DELETE FROM public.fish_caught WHERE user_id = _uid;
  DELETE FROM public.fish_stock WHERE user_id = _uid;
  DELETE FROM public.ships_owned WHERE user_id = _uid;
  DELETE FROM public.lootbox_owned WHERE user_id = _uid;
  DELETE FROM public.user_market WHERE user_id = _uid;
  DELETE FROM public.user_market_state WHERE user_id = _uid;
  DELETE FROM public.user_fish_market WHERE user_id = _uid;
  DELETE FROM public.user_layout WHERE user_id = _uid;
  DELETE FROM public.user_action_throttle WHERE user_id = _uid;
  DELETE FROM public.transactions WHERE user_id = _uid;
  DELETE FROM public.transaction_logs WHERE user_id = _uid;
  DELETE FROM public.code_redemptions WHERE user_id = _uid;

  DELETE FROM public.daily_login_streaks WHERE user_id = _uid;
  DELETE FROM public.quest_progress WHERE user_id = _uid;
  DELETE FROM public.royal_box_claims WHERE user_id = _uid;
  DELETE FROM public.user_achievements WHERE user_id = _uid;

  DELETE FROM public.dragon_claims WHERE user_id = _uid;
  DELETE FROM public.dragon_equipment WHERE user_id = _uid;
  DELETE FROM public.dragons WHERE user_id = _uid;
  DELETE FROM public.player_daughter WHERE user_id = _uid;

  DELETE FROM public.vip_daily_claims WHERE user_id = _uid;
  DELETE FROM public.vip_shield_claims WHERE user_id = _uid;
  DELETE FROM public.elite_vip_daily_claims WHERE user_id = _uid;
  DELETE FROM public.elite_vip_login_broadcasts WHERE user_id = _uid;

  DELETE FROM public.subscriptions WHERE user_id = _uid;
  DELETE FROM public.paddle_purchases WHERE user_id = _uid;
  DELETE FROM public.polar_purchases WHERE user_id = _uid;
  DELETE FROM public.stripe_purchases WHERE user_id = _uid;
  DELETE FROM public.shopify_orders WHERE user_id = _uid;

  DELETE FROM public.friends WHERE requester_id = _uid OR addressee_id = _uid;
  DELETE FROM public.user_blocks WHERE blocker_id = _uid OR blocked_id = _uid;
  DELETE FROM public.messages WHERE sender_id = _uid OR recipient_id = _uid;
  DELETE FROM public.notifications WHERE recipient_id = _uid OR created_by = _uid;
  DELETE FROM public.notification_reads WHERE user_id = _uid;
  DELETE FROM public.support_gifts WHERE sender_id = _uid OR recipient_id = _uid;
  DELETE FROM public.support_ticket_messages WHERE sender_id = _uid OR ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id = _uid);
  DELETE FROM public.support_tickets WHERE user_id = _uid;
  DELETE FROM public.profile_media WHERE user_id = _uid;
  DELETE FROM public.referral_earnings WHERE inviter_id = _uid OR invitee_id = _uid;

  DELETE FROM public.forum_topic_votes WHERE user_id = _uid;
  DELETE FROM public.forum_replies WHERE user_id = _uid;
  DELETE FROM public.forum_topics WHERE user_id = _uid;
  DELETE FROM public.forum_bans WHERE user_id = _uid;
  DELETE FROM public.chat_mutes WHERE user_id = _uid;
  DELETE FROM public.profanity_warnings WHERE user_id = _uid;

  DELETE FROM public.competition_catches WHERE user_id = _uid;

  DELETE FROM public.tribe_join_requests WHERE user_id = _uid;
  DELETE FROM public.tribe_members WHERE user_id = _uid;
  DELETE FROM public.tribe_donations WHERE user_id = _uid;
  DELETE FROM public.tribe_gem_daily WHERE user_id = _uid;
  DELETE FROM public.tribe_wars WHERE declarer_id = _uid OR target_id = _uid;
  UPDATE public.tribes SET owner_id = NULL WHERE owner_id = _uid;

  DELETE FROM public.device_accounts WHERE user_id = _uid;
  DELETE FROM public.device_history WHERE user_id = _uid;
  DELETE FROM public.user_ips WHERE user_id = _uid;
  DELETE FROM public.account_links WHERE user_a = _uid OR user_b = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid;
  DELETE FROM public.bans WHERE user_id = _uid;
  DELETE FROM public.banned_devices WHERE user_id = _uid;

  UPDATE public.admin_audit SET target_user_id = NULL WHERE target_user_id = _uid;

  DELETE FROM public.profiles WHERE id = _uid;
END;
$$;
