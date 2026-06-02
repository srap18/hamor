REVOKE EXECUTE ON FUNCTION public.set_ship_at_sea(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ship_at_sea(uuid, boolean) TO authenticated;