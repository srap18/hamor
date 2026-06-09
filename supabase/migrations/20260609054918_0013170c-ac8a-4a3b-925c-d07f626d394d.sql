CREATE OR REPLACE FUNCTION public.fish_market_capacity(_level integer)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE _lvl int := GREATEST(1, LEAST(30, COALESCE(_level, 1))); _cap bigint := 10000; _l int;
BEGIN
  FOR _l IN 2.._lvl LOOP
    IF _l <= 10 THEN _cap := _cap + 10000;
    ELSIF _l <= 20 THEN _cap := _cap + 20000;
    ELSIF _l <= 26 THEN _cap := _cap + 33333;
    ELSE _cap := _cap + 500000;
    END IF;
  END LOOP;
  IF _lvl = 26 THEN _cap := 500000; END IF;
  IF _lvl = 27 THEN _cap := 1000000; END IF;
  IF _lvl = 28 THEN _cap := 1500000; END IF;
  IF _lvl = 29 THEN _cap := 2000000; END IF;
  IF _lvl = 30 THEN _cap := 2500000; END IF;
  RETURN _cap;
END $function$;