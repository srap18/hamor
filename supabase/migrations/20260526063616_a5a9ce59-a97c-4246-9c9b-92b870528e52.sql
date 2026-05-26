
REVOKE EXECUTE ON FUNCTION public.recompute_fish_prices() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_fish_prices() TO service_role;
