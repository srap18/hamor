
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications_batch()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
  v_tmp int;
BEGIN
  -- Batch delete old notifications
  WITH d AS (
    DELETE FROM public.notifications
    WHERE id IN (
      SELECT id FROM public.notifications
      WHERE created_at < now() - interval '14 days'
      LIMIT 5000
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_tmp FROM d;
  v_deleted := v_deleted + v_tmp;

  -- Batch delete orphan reads
  WITH d AS (
    DELETE FROM public.notification_reads nr
    WHERE nr.notification_id IN (
      SELECT nr2.notification_id
      FROM public.notification_reads nr2
      LEFT JOIN public.notifications n ON n.id = nr2.notification_id
      WHERE n.id IS NULL
      LIMIT 5000
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_tmp FROM d;
  v_deleted := v_deleted + v_tmp;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_notifications_batch() FROM public;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications_batch() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN ('cleanup_old_notifications_hourly','cleanup_old_notifications_batch');

    PERFORM cron.schedule(
      'cleanup_old_notifications_batch',
      '*/5 * * * *',
      $cron$ SELECT public.cleanup_old_notifications_batch(); $cron$
    );
  END IF;
END $$;
