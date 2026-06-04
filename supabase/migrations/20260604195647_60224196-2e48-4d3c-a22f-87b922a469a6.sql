CREATE OR REPLACE FUNCTION public.repair_target_burned_bg(_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _gems integer;
  _burned_until timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL THEN RAISE EXCEPTION 'target required'; END IF;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _uid;
  IF _gems IS NULL OR _gems < 100 THEN RAISE EXCEPTION 'not enough gems'; END IF;

  SELECT bg_burned_until INTO _burned_until FROM public.profiles WHERE id = _target_id;
  IF _burned_until IS NULL OR _burned_until <= now() THEN
    RAISE EXCEPTION 'not burned';
  END IF;

  UPDATE public.profiles SET gems = gems - 100 WHERE id = _uid;
  UPDATE public.profiles SET bg_burned_until = NULL WHERE id = _target_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repair_target_burned_bg(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.repair_target_burned_bg(uuid) TO authenticated;