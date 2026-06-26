
DO $$
DECLARE
  fn record;
  names text[] := ARRAY[
    'add_vip_points','admin_set_player_currency','attack_grant_tribe_gems','auto_grant_admin',
    'award_event_xp','bump_achievement_progress','bump_quest_progress','buy_background',
    'deduct_gems_for_voice_change','flag_cheat','grant_inventory_item','grant_paddle_purchase',
    'grant_polar_purchase','grant_stripe_purchase','grant_referral_bonus','notify_steal_started',
    'revoke_vip_protection','set_audit_context','stamp_global_last_attack','tribe_donation_grant_gems',
    'mirror_last_destroyer_to_global','notify_attack_received','push_global_banner',
    'post_elite_vip_login_broadcast','log_competition_catch','finalize_competition',
    'finalize_due_competitions','finalize_fish_market_upgrades','finalize_market_upgrades',
    'finalize_ship_repairs','cleanup_elite_login_broadcasts','cleanup_empty_voice_rooms',
    'cleanup_expired_sanctions','cleanup_global_banners','cleanup_old_competition_catches',
    'cleanup_voice_artifacts','sweep_expired_crews','sweep_expired_elite_vip',
    'sync_chat_mute_devices_ips','sync_tribe_total_donations','process_tribe_overflow_kicks',
    'purge_old_messages','prune_messages_keep_last_50','purge_member_support_on_leave',
    'recompute_fish_prices','restore_member_donations_on_join','warn_overfull_tribes',
    'delete_tribe_if_empty','test_steal_cancel_moves_one_fish','test_steal_claim_moves_one_fish',
    'handle_new_user','handle_new_user_admin_check','handle_new_user_daughter',
    'handle_new_user_market','handle_new_user_role','handle_new_user_starter_ship',
    'prevent_duplicate_auth_email','enforce_bg_ownership','forum_check_not_banned',
    'forum_topic_votes_count_trg','protect_profile_sensitive_columns','guard_tribe_members_update',
    'guard_tribes_update','trg_attack_arena_score','trg_attack_progress','trg_boss_progress',
    'trg_fish_caught_progress'
  ];
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;',
                   fn.proname, fn.args);
  END LOOP;
END $$;

-- Defense-in-depth admin check on admin_set_player_currency
CREATE OR REPLACE FUNCTION public.admin_set_player_currency(_player uuid, _coins bigint, _gems integer, _xp integer, _level integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _rubies integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  SELECT rubies INTO _rubies FROM public.profiles WHERE id = _player;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  PERFORM public.admin_set_player_full(_player, _coins, _gems, _rubies, _xp, _level);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_set_player_currency(uuid, bigint, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_player_currency(uuid, bigint, integer, integer, integer) TO authenticated;
