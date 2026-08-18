DO $cleanup$
BEGIN
  PERFORM set_config('app.server_write', 'on', true);

  UPDATE public.ships_owned s
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
    FROM public.profiles p
   WHERE p.id = s.user_id
     AND COALESCE(p.golden_fisher_paused, false) = true
     AND COALESCE(s.in_storage, false) = false
     AND s.stealing_target_user_id IS NULL
     AND s.stealing_ends_at IS NULL
     AND (COALESCE(s.at_sea, false) OR s.fishing_started_at IS NOT NULL OR s.last_fishing_reward_at IS NOT NULL);

  PERFORM set_config('app.server_write', 'off', true);
END;
$cleanup$;