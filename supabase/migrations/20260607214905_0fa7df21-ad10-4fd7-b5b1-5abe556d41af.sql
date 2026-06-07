
-- Ensure pg_cron is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Immediately fix any currently-stuck destroyed ships whose repair time already passed
SELECT public.finalize_ship_repairs();

-- Unschedule previous job if it exists, then re-schedule
DO $$
BEGIN
  PERFORM cron.unschedule('finalize-ship-repairs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'finalize-ship-repairs',
  '* * * * *',
  $$ SELECT public.finalize_ship_repairs(); $$
);
