-- Block client-side abuse of increment_fish_caught
REVOKE EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) TO service_role;