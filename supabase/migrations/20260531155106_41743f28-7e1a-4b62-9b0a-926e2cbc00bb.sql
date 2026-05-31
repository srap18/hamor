
CREATE OR REPLACE FUNCTION public.is_display_name_taken(p_name text, p_except uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(btrim(display_name)) = lower(btrim(p_name))
      AND (p_except IS NULL OR id <> p_except)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_display_name_taken(text, uuid) TO anon, authenticated;
