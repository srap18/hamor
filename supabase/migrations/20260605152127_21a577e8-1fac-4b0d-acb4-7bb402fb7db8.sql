
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_old_competition_catches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.competition_catches cc
  WHERE NOT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.active = true
      AND cc.caught_at >= c.starts_at
      AND cc.caught_at <= c.ends_at
  )
  AND cc.caught_at < now() - interval '1 day';
END;
$$;

SELECT cron.unschedule('cleanup-old-competition-catches')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-old-competition-catches');

SELECT cron.schedule(
  'cleanup-old-competition-catches',
  '0 3 * * *',
  $$SELECT public.cleanup_old_competition_catches();$$
);
