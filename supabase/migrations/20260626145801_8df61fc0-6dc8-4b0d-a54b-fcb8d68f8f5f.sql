-- Tighten RPC execute permissions for quest/achievement claiming.
-- These functions still require auth.uid(), but this removes anonymous SECURITY DEFINER exposure.
REVOKE ALL ON FUNCTION public.claim_daily_quest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_daily_quest(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_quest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_quest(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_achievement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_achievement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_achievement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_achievement(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM anon;
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.qa_award(uuid, integer, bigint, integer) TO service_role;