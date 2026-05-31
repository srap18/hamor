
-- Allow admins to delete chat messages (for manual moderation)
DROP POLICY IF EXISTS msg_delete_admin ON public.messages;
CREATE POLICY msg_delete_admin
ON public.messages
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

-- Auto-purge chat messages older than 24 hours
CREATE OR REPLACE FUNCTION public.purge_old_messages()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.messages
  WHERE created_at < (now() - interval '24 hours');
$$;

-- Schedule it every 10 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-old-messages') THEN
    PERFORM cron.unschedule('purge-old-messages');
  END IF;
  PERFORM cron.schedule(
    'purge-old-messages',
    '*/10 * * * *',
    $cron$ SELECT public.purge_old_messages(); $cron$
  );
END $$;

-- Immediate first run
SELECT public.purge_old_messages();
