CREATE OR REPLACE FUNCTION public.remove_ad_bombs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _gems integer;
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT count(*) INTO _count
  FROM public.ad_bombs
  WHERE target_user_id = _uid AND active = true AND expires_at > now();

  IF _count = 0 THEN RETURN 0; END IF;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _gems IS NULL OR _gems < 150 THEN RAISE EXCEPTION 'insufficient gems'; END IF;

  UPDATE public.profiles SET gems = gems - 150 WHERE id = _uid;

  UPDATE public.ad_bombs SET active = false
  WHERE target_user_id = _uid AND active = true AND expires_at > now();

  RETURN _count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_ad_bombs() TO authenticated;