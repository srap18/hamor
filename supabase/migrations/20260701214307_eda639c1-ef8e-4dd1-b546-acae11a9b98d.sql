REVOKE EXECUTE ON FUNCTION public.pvp_ship_level(integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.effective_market_level(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pvp_fleet_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pvp_requirement_error(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_pvp_fleet(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_market_pvp_unlocked(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._prep_pvp_checks(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pvp_ship_level(integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_market_level(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pvp_fleet_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pvp_requirement_error(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_pvp_fleet(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_market_pvp_unlocked(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._prep_pvp_checks(uuid) TO authenticated, service_role;