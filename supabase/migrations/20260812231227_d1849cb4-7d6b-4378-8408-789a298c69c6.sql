REVOKE EXECUTE ON FUNCTION public.upgrade_royal_whale(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.upgrade_royal_whale(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.upgrade_royal_whale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_royal_whale(uuid) TO service_role;