REVOKE EXECUTE ON FUNCTION public.set_ship_at_sea(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ship_at_sea(uuid, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) TO authenticated;