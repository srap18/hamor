
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_expired_sanctions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bans SET active = false
   WHERE active = true AND expires_at IS NOT NULL AND expires_at <= now();
  UPDATE public.chat_mutes SET active = false
   WHERE active = true AND expires_at IS NOT NULL AND expires_at <= now();
$$;

SELECT cron.unschedule('cleanup-expired-sanctions') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-sanctions'
);

SELECT cron.schedule(
  'cleanup-expired-sanctions',
  '*/5 * * * *',
  $$SELECT public.cleanup_expired_sanctions();$$
);
