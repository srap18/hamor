REVOKE ALL ON FUNCTION public.refund_ban_user(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paddle_refund_sweep_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ban_user(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.paddle_refund_sweep_tick() TO service_role, postgres;