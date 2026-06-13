CREATE OR REPLACE FUNCTION public.fish_market_capacity(_level integer)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $function$
DECLARE _lvl int := GREATEST(1, LEAST(30, COALESCE(_level, 1))); _cap bigint := 10000; _l int;
BEGIN
  IF _lvl = 26 THEN RETURN 6000000; END IF;
  IF _lvl = 27 THEN RETURN 11000000; END IF;
  IF _lvl = 28 THEN RETURN 17000000; END IF;
  IF _lvl = 29 THEN RETURN 23000000; END IF;
  IF _lvl = 30 THEN RETURN 30000000; END IF;
  FOR _l IN 2.._lvl LOOP
    IF _l <= 10 THEN _cap := _cap + 10000;
    ELSIF _l <= 20 THEN _cap := _cap + 20000;
    ELSE _cap := _cap + 116666;
    END IF;
  END LOOP;
  RETURN _cap;
END $function$;