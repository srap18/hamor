REVOKE ALL ON FUNCTION public.ship_to_storage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ship_to_storage(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ship_to_storage(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.upgrade_ship_storage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_ship_storage() FROM anon;
GRANT EXECUTE ON FUNCTION public.upgrade_ship_storage() TO authenticated;