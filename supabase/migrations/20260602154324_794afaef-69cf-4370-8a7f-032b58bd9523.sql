REVOKE EXECUTE ON FUNCTION public.buy_trader_unlock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.use_crew_from_inventory(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_trader_unlock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_crew_from_inventory(uuid, uuid) TO authenticated;