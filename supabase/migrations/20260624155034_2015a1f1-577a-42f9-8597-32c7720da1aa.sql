-- Cancel all ship purchases and ship/fish market upgrades of level 18+ from the last hour.

-- 1. Delete level 18+ ships purchased in the last hour.
DELETE FROM public.ships_owned
WHERE acquired_at > now() - interval '1 hour'
  AND catalog_code ~ '^ship-lvl-(1[89]|[2-9][0-9])$';

-- 2. Cancel in-progress ship-market upgrades to level 18+ started in the last hour.
UPDATE public.user_market
   SET upgrading_to = NULL,
       upgrade_started_at = NULL,
       upgrade_ends_at = NULL,
       upgrade_cost_coins = NULL,
       updated_at = now()
 WHERE upgrading_to >= 18
   AND upgrade_started_at > now() - interval '1 hour';

-- 3. Revert ship-market upgrades that completed in the last hour to level 18+ (rollback by 1).
UPDATE public.user_market
   SET level = GREATEST(1, level - 1),
       updated_at = now()
 WHERE level >= 18
   AND upgrading_to IS NULL
   AND updated_at > now() - interval '1 hour';

-- 4. Cancel in-progress fish-market upgrades to level 18+ started in the last hour.
UPDATE public.user_fish_market
   SET upgrading_to = NULL,
       upgrade_started_at = NULL,
       upgrade_ends_at = NULL,
       upgrade_cost_coins = NULL,
       updated_at = now()
 WHERE upgrading_to >= 18
   AND upgrade_started_at > now() - interval '1 hour';

-- 5. Revert fish-market upgrades that completed in the last hour to level 18+ (rollback by 1).
UPDATE public.user_fish_market
   SET level = GREATEST(1, level - 1),
       updated_at = now()
 WHERE level >= 18
   AND upgrading_to IS NULL
   AND updated_at > now() - interval '1 hour';