CREATE OR REPLACE FUNCTION public.mark_me_offline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET online_at = now() - interval '1 hour' WHERE id = _uid;
END;
$$;