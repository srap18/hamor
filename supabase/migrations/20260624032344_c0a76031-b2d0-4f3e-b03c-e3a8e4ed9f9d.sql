REVOKE EXECUTE ON FUNCTION public.get_active_boss() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_active_boss() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_boss() TO authenticated;