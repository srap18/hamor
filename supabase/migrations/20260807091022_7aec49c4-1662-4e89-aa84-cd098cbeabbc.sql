ALTER TABLE public.user_fish_market
  ADD COLUMN IF NOT EXISTS rented_capacity bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rented_until timestamptz;

-- Effective capacity = level capacity + active rented capacity
CREATE OR REPLACE FUNCTION public.user_market_capacity(_uid uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _lvl int; _rc bigint := 0; _ru timestamptz;
BEGIN
  SELECT COALESCE(level,1), COALESCE(rented_capacity,0), rented_until
    INTO _lvl, _rc, _ru
  FROM public.user_fish_market WHERE user_id = _uid;
  IF _lvl IS NULL THEN _lvl := 1; END IF;
  IF _ru IS NULL OR _ru <= now() THEN _rc := 0; END IF;
  RETURN public.fish_market_capacity(_lvl) + GREATEST(0, _rc);
END $$;

GRANT EXECUTE ON FUNCTION public.user_market_capacity(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_market_remaining(_uid uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cap bigint; _used bigint;
BEGIN
  _cap := public.user_market_capacity(_uid);
  SELECT COALESCE(SUM(GREATEST(0, quantity)),0)::bigint INTO _used FROM public.fish_stock WHERE user_id = _uid;
  RETURN GREATEST(0, _cap - _used);
END $$;

-- Rent extra capacity (24h) with gems
CREATE OR REPLACE FUNCTION public.rent_market_capacity(_pack text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  IF _ru IS NULL OR _ru <= now() THEN _rc := 0; _ru := now(); END IF;

  PERFORM public._mutate_currency(_uid, 0, -_cost, 0, 0);

  UPDATE public.user_fish_market
     SET rented_capacity = _rc + _cap,
         rented_until = _ru + interval '24 hours',
         updated_at = now()
   WHERE user_id = _uid;

  SELECT COALESCE(rented_capacity,0), rented_until INTO _rc, _ru
    FROM public.user_fish_market WHERE user_id = _uid;

  RETURN jsonb_build_object('ok', true, 'rented_capacity', _rc, 'rented_until', _ru, 'capacity', public.user_market_capacity(_uid));
END $$;

REVOKE ALL ON FUNCTION public.rent_market_capacity(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rent_market_capacity(text) TO authenticated;