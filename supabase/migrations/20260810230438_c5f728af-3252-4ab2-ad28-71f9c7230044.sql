REVOKE ALL ON FUNCTION public.golden_fisher_active_until(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.golden_fisher_active_until(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.award_vip_cashback(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_vip_cashback(uuid, bigint, text) TO authenticated, service_role;