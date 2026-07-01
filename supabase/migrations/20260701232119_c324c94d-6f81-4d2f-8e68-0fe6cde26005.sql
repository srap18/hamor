CREATE OR REPLACE FUNCTION public.add_xp(_uid uuid, _xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _safe_xp integer := GREATEST(0, LEAST(COALESCE(_xp, 0), 100000));
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'missing user id';
  END IF;

  IF _safe_xp <= 0 THEN
    RETURN;
  END IF;

  PERFORM public._mutate_currency(_uid, 0, 0, 0, _safe_xp);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.add_xp(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_xp(uuid, integer) TO authenticated, service_role;