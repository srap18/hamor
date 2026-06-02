CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS TABLE(server_now timestamptz, server_today date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now(), (now() AT TIME ZONE 'UTC')::date;
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated, service_role;