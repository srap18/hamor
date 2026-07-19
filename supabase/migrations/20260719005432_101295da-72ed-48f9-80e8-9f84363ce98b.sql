
-- Fix weekly XP tracking + compensate + weekly reset cron

-- 1) Real tracking trigger
CREATE OR REPLACE FUNCTION public.track_weekly_xp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.xp IS NOT NULL AND OLD.xp IS NOT NULL AND NEW.xp > OLD.xp THEN
    NEW.weekly_xp := COALESCE(OLD.weekly_xp, 0) + (NEW.xp - OLD.xp);
  END IF;
  RETURN NEW;
END $$;

-- 2) Backfill weekly_xp for current week from attack/nuke/ad_bomb history
--    (does NOT touch xp/level/coins/gems)
WITH cfg AS (
  SELECT week_started_at FROM public.weekly_xp_config WHERE id = true
),
atk AS (
  SELECT a.attacker_id AS uid,
         SUM(LEAST(200, GREATEST(5, (COALESCE(a.damage_dealt,0) / 2000)::int)))::bigint AS xp
    FROM public.attacks a, cfg
   WHERE a.attacker_id IS NOT NULL
     AND COALESCE(a.damage_dealt,0) > 0
     AND a.created_at >= cfg.week_started_at
   GROUP BY a.attacker_id
),
adb AS (
  SELECT b.attacker_id AS uid, (COUNT(*) * 200)::bigint AS xp
    FROM public.ad_bombs b, cfg
   WHERE b.attacker_id IS NOT NULL
     AND b.created_at >= cfg.week_started_at
   GROUP BY b.attacker_id
),
nuk AS (
  SELECT g.attacker_id AS uid, (COUNT(*) * 250)::bigint AS xp
    FROM public.global_banners g, cfg
   WHERE g.attacker_id IS NOT NULL
     AND g.kind = 'nuke'
     AND g.created_at >= cfg.week_started_at
   GROUP BY g.attacker_id
),
totals AS (
  SELECT uid, SUM(xp)::int AS xp FROM (
    SELECT * FROM atk UNION ALL
    SELECT * FROM adb UNION ALL
    SELECT * FROM nuk
  ) x
  GROUP BY uid
)
UPDATE public.profiles p
   SET weekly_xp = GREATEST(COALESCE(p.weekly_xp,0), LEAST(t.xp, 2147483000))
  FROM totals t
 WHERE p.id = t.uid
   AND NOT public.is_admin(p.id);

-- 3) Weekly cron — distribute prizes + reset every Monday 00:00 UTC
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule('weekly_xp_distribute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'weekly_xp_distribute',
  '0 0 * * 1',
  $$SELECT public.distribute_weekly_xp_prizes();$$
);
