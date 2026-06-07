REVOKE EXECUTE ON FUNCTION public.repair_ship_with_crew(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.use_crew_from_inventory(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assign_crew_to_ship(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.repair_ship_with_crew(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_crew_from_inventory(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_crew_to_ship(uuid, text) TO authenticated;