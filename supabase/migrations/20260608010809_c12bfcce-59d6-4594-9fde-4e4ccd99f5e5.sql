REVOKE EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) TO service_role;