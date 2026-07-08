CREATE OR REPLACE FUNCTION public.ludo_color_start_offset(_color text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _color
    WHEN 'blue'   THEN 0
    WHEN 'yellow' THEN 13
    WHEN 'red'    THEN 26
    WHEN 'green'  THEN 39
    ELSE 0
  END;
$function$;