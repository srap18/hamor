REVOKE ALL ON FUNCTION public.send_support(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO service_role;