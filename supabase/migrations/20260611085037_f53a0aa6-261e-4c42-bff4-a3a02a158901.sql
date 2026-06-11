REVOKE EXECUTE ON FUNCTION public.assign_crew_to_ship(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_crew_to_ship(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_crew_to_ship(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_crew_to_ship(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;