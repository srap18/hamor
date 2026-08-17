CREATE OR REPLACE FUNCTION public.repair_ship_instant(_ship_id uuid, _gems_cost integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'gem_repair_disabled: الإصلاح بالجواهر متوقف — استخدم طاقم الإصلاح';
END;
$$;