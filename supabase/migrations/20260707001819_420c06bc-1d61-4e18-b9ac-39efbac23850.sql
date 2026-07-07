CREATE OR REPLACE FUNCTION public.ludo_color_start_offset(_color text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _color
    WHEN 'green' THEN 0
    WHEN 'blue' THEN 13
    WHEN 'yellow' THEN 26
    WHEN 'red' THEN 39
    ELSE 0
  END;
$function$;