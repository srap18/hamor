
-- Treat expired Elite VIP as level 0 server-side
CREATE OR REPLACE FUNCTION public.get_elite_vip_level(_user_id uuid)
 RETURNS smallint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN elite_vip_expires_at IS NOT NULL AND elite_vip_expires_at <= now() THEN 0::smallint
    ELSE COALESCE(elite_vip_level, 0)::smallint
  END
  FROM public.profiles
  WHERE id = _user_id;
$function$;

-- Sweep function: zero out any expired Elite VIP rows
CREATE OR REPLACE FUNCTION public.sweep_expired_elite_vip()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.profiles
       SET elite_vip_level = 0,
           elite_vip_expires_at = NULL
     WHERE elite_vip_level > 0
       AND elite_vip_expires_at IS NOT NULL
       AND elite_vip_expires_at <= now()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$function$;

-- Only service_role / admin should call the sweep
REVOKE EXECUTE ON FUNCTION public.sweep_expired_elite_vip() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_elite_vip() TO service_role;

-- Schedule the sweep every 5 minutes via pg_cron (if available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('sweep_expired_elite_vip')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep_expired_elite_vip');
    PERFORM cron.schedule(
      'sweep_expired_elite_vip',
      '*/5 * * * *',
      $cron$SELECT public.sweep_expired_elite_vip();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Ignore if pg_cron not installed or scheduling fails
  NULL;
END $$;
