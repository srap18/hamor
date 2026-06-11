
-- Lock down elite_vip_expires_at: clients can no longer read it directly.
REVOKE SELECT (elite_vip_expires_at) ON public.profiles FROM anon, authenticated;

-- Secure RPC for the owner (or admin) to read their own VIP expiry.
CREATE OR REPLACE FUNCTION public.get_my_elite_vip()
RETURNS TABLE(elite_vip_level int, elite_vip_expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.elite_vip_level, p.elite_vip_expires_at
  FROM public.profiles p
  WHERE p.id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_my_elite_vip() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_elite_vip() TO authenticated;

-- Admin variant for admin pages that need to inspect any user.
CREATE OR REPLACE FUNCTION public.admin_get_elite_vip(_user_id uuid)
RETURNS TABLE(elite_vip_level int, elite_vip_expires_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT p.elite_vip_level, p.elite_vip_expires_at
    FROM public.profiles p
    WHERE p.id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_elite_vip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_elite_vip(uuid) TO authenticated;
