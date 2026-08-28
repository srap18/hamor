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
  _old_cost numeric;
  _remaining_sec numeric := 0;
  _converted_sec numeric := 0;
  _new_until timestamptz;
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

  -- Anti-exploit: cannot extend a higher active rental with a cheaper pack
  IF _rc > 0 AND _cap < _rc THEN
    RAISE EXCEPTION 'سعتك المستأجرة الحالية (+%) أعلى من هذه الباقة — اختر باقة بنفس السعة أو أعلى للتمديد', _rc;
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_cost, 0, 0);

  _remaining_sec := GREATEST(0, EXTRACT(EPOCH FROM (_ru - now())));

  IF _rc = 0 OR _cap = _rc THEN
    -- fresh rental or same-tier extension: keep remaining time, add 24h
    _converted_sec := _remaining_sec;
  ELSE
    -- upgrade to a bigger pack: convert remaining time by price ratio so that
    -- cheap packs can no longer be stockpiled and then upgraded for free
    _old_cost := CASE
      WHEN _rc >= 50000000 THEN 3000
      WHEN _rc >= 25000000 THEN 1500
      ELSE 500
    END;
    _converted_sec := _remaining_sec * (_old_cost / _cost::numeric);
  END IF;

  _new_until := now() + make_interval(secs => _converted_sec) + interval '24 hours';
  -- hard cap on stacked duration
  IF _new_until > now() + interval '30 days' THEN
    _new_until := now() + interval '30 days';
  END IF;

  UPDATE public.user_fish_market
     SET rented_capacity = GREATEST(_rc, _cap),
         rented_until = _new_until,
         updated_at = now()
   WHERE user_id = _uid;

  SELECT COALESCE(rented_capacity,0), rented_until INTO _rc, _ru
    FROM public.user_fish_market WHERE user_id = _uid;

  RETURN jsonb_build_object('ok', true, 'rented_capacity', _rc, 'rented_until', _ru, 'capacity', public.user_market_capacity(_uid));
END $function$;