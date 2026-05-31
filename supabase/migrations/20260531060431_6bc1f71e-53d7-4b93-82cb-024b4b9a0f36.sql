CREATE OR REPLACE FUNCTION public.get_staff_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin', 'moderator');
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_user_ids() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','moderator'));
$$;

GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated;