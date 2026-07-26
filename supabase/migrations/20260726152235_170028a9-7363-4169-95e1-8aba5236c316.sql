
REVOKE ALL ON FUNCTION public._log_payment_delivery(text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._log_payment_delivery(text, uuid, text, text, jsonb) TO service_role;
