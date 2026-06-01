CREATE OR REPLACE FUNCTION public.repair_burned_bg()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _gems integer;
  _burned_until timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT gems, bg_burned_until INTO _gems, _burned_until
  FROM public.profiles WHERE id = _uid FOR UPDATE;

  IF _burned_until IS NULL OR _burned_until <= now() THEN
    RAISE EXCEPTION 'not burned';
  END IF;

  IF _gems IS NULL OR _gems < 100 THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  UPDATE public.profiles
     SET gems = gems - 100,
         bg_burned_until = NULL
   WHERE id = _uid;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.repair_burned_bg() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.repair_burned_bg() FROM anon, public;