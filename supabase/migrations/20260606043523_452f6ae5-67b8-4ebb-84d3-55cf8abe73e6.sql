
DO $$
BEGIN
  PERFORM cron.unschedule('distribute-weekly-xp');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Friday 21:00 UTC = Saturday 00:00 KSA (منتصف ليلة الجمعة بتوقيت السعودية)
SELECT cron.schedule(
  'distribute-weekly-xp',
  '0 21 * * 5',
  $cron$ SELECT public.distribute_weekly_xp_prizes(); $cron$
);
