
CREATE OR REPLACE FUNCTION public.users_same_device(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _a IS NULL OR _b IS NULL OR _a = _b THEN false
    ELSE COALESCE(
      (public.device_match_score(_a, _b) ->> 'score')::int >= 60
      AND (public.device_match_score(_a, _b) ->> 'signals')::int >= 1,
      false)
  END;
$function$;
