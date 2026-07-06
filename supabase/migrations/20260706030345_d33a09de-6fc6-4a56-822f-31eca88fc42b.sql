-- 1) Phoenix ship (template 31) repairs in 3 hours; all other levels unchanged.
CREATE OR REPLACE FUNCTION public._ship_repair_seconds(_template_id integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(_template_id, 1) >= 31 THEN 10800  -- Phoenix ship: 3 hours
    ELSE ROUND(10800 + (LEAST(30, GREATEST(1, COALESCE(_template_id, 1))) - 1) * (86400 - 10800) / 29.0)::int
  END
$function$;