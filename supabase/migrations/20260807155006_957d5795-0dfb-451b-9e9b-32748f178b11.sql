CREATE OR REPLACE FUNCTION public.rent_market_capacity(_pack text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _lvl int;
  _cap bigint;
  _cost int;
  _rc bigint;
  _ru timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF _pack = 'small' THEN _cap := 10000000; _cost := 500;
  ELSIF _pack = 'medium' THEN _cap := 25000000; _cost := 1500;
  ELSIF _pack = 'large' THEN _cap := 50000000; _cost := 3000;
  ELSE RAISE EXCEPTION 'باقة غير معروفة';
  END IF;

  SELECT COALESCE(level,1), COALESCE(rented_capacity,0), rented_until
    INTO _lvl, _rc, _ru
  FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;

  IF _lvl IS NULL OR _lvl < 30 THEN
    RAISE EXCEPTION 'الاستئجار متاح فقط عند مستوى سوق السمك 30';
  END IF;

  -- expired or no active rental -> start fresh from now
  IF _ru IS NULL OR _ru <= now() THEN _rc := 0; _ru := now(); END IF;

  PERFORM public._mutate_currency(_uid, 0, -_cost, 0, 0);

  -- NO stacking of capacity: keep the highest package, only extend the time
  UPDATE public.user_fish_market
     SET rented_capacity = GREATEST(_rc, _cap),
         rented_until = _ru + interval '24 hours',
         updated_at = now()
   WHERE user_id = _uid;

  SELECT COALESCE(rented_capacity,0), rented_until INTO _rc, _ru
    FROM public.user_fish_market WHERE user_id = _uid;

  RETURN jsonb_build_object('ok', true, 'rented_capacity', _rc, 'rented_until', _ru, 'capacity', public.user_market_capacity(_uid));
END $function$;

UPDATE public.user_fish_market
   SET rented_capacity = 50000000, updated_at = now()
 WHERE COALESCE(rented_capacity,0) > 50000000;