REVOKE ALL ON FUNCTION public.upgrade_submarine(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_submarine(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.upgrade_submarine(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_submarine(uuid) TO service_role;