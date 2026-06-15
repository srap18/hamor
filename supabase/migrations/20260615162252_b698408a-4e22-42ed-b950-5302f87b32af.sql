CREATE OR REPLACE FUNCTION public.has_pvp_fleet(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COUNT(*) FROM public.ships_owned
      WHERE user_id = _user_id
        AND in_storage = false
        AND destroyed_at IS NULL
        AND COALESCE(template_id, 0) >= 6
        AND (
          COALESCE(max_hp, 0) = 0
          OR (COALESCE(hp, 0)::numeric / NULLIF(max_hp, 0)::numeric) >= 0.30
        )
      ), 0) >= 3
$$;