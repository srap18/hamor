-- Fix Golden Fisher getting stuck when a player's lifetime fish counters exceed 32-bit integer limits.
ALTER TABLE public.fish_caught
  ALTER COLUMN quantity TYPE bigint USING quantity::bigint,
  ALTER COLUMN total_caught TYPE bigint USING total_caught::bigint;

ALTER TABLE public.fish_stock
  ALTER COLUMN quantity TYPE bigint USING quantity::bigint;

-- Active Golden Fisher ships that were repeatedly failing during reward insert
-- stayed visually ready forever. Reset their live timers so they continue with
-- a clean new cycle after the integer limit fix above.
UPDATE public.ships_owned s
   SET at_sea = true,
       fishing_started_at = now(),
       last_fishing_reward_at = now()
  FROM public.profiles p
 WHERE p.id = s.user_id
   AND public.golden_fisher_active_until(s.user_id) > now()
   AND COALESCE(p.golden_fisher_paused, false) = false
   AND COALESCE(s.in_storage, false) = false
   AND s.destroyed_at IS NULL
   AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
   AND s.stealing_target_user_id IS NULL
   AND s.stealing_ends_at IS NULL
   AND s.at_sea = true
   AND s.fishing_started_at IS NOT NULL;

-- Keep function permissions explicit after type widening.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fish_caught TO authenticated;
GRANT ALL ON public.fish_caught TO service_role;
GRANT SELECT ON public.fish_stock TO authenticated;
GRANT ALL ON public.fish_stock TO service_role;