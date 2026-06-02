-- Clear stale fishing trips (older than 24h) so the second/third ship doesn't
-- auto-launch from leftover state when a player re-opens the harbor.
UPDATE public.ships_owned
SET at_sea = false, fishing_started_at = NULL
WHERE at_sea = true
  AND fishing_started_at IS NOT NULL
  AND now() - fishing_started_at > interval '24 hours';