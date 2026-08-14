CREATE OR REPLACE FUNCTION public.cleanup_golden_fisher_rewards()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _deleted int := 0;
BEGIN
  WITH doomed AS (
    SELECT ctid FROM public.golden_fisher_rewards
     WHERE created_at < now() - interval '2 days'
     LIMIT 200000
  )
  DELETE FROM public.golden_fisher_rewards g
   USING doomed d WHERE g.ctid = d.ctid;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

SELECT cron.schedule('cleanup-golden-fisher-rewards', '*/10 * * * *', 'SELECT public.cleanup_golden_fisher_rewards();');