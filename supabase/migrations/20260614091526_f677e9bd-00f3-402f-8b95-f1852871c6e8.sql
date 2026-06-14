
CREATE OR REPLACE FUNCTION public.admin_profile_totals()
RETURNS TABLE(total_coins bigint, total_gems bigint, total_xp bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT
      COALESCE(SUM(coins),0)::bigint AS total_coins,
      COALESCE(SUM(gems),0)::bigint  AS total_gems,
      COALESCE(SUM(xp),0)::bigint    AS total_xp
    FROM public.profiles;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_profile_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_profile_totals() TO authenticated, service_role;
