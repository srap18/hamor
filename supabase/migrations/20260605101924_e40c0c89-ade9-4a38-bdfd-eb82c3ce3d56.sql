
ALTER TABLE public.user_market_state
  ADD COLUMN IF NOT EXISTS trader_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS trader_anchor timestamptz;

-- Helper: build a snapshot of next 9 hourly prices for each fish from current global forecast.
CREATE OR REPLACE FUNCTION public.build_trader_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  r record;
BEGIN
  FOR r IN SELECT fish_id, forecast FROM public.fish_market_prices LOOP
    result := result || jsonb_build_object(r.fish_id, COALESCE(r.forecast, '[]'::jsonb));
  END LOOP;
  RETURN result;
END;
$$;

-- Anchor = top of next hour (when forecast[0] becomes the new current_price).
CREATE OR REPLACE FUNCTION public.trader_snapshot_anchor()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT date_trunc('hour', now()) + interval '1 hour';
$$;

-- Patch buy_trader_unlock to also store the snapshot when paid path is taken.
CREATE OR REPLACE FUNCTION public.buy_trader_unlock()
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _inv_id uuid;
  _ends timestamptz;
  _bal int;
  _snap jsonb;
  _anchor timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  -- Free crew path
  SELECT id INTO _inv_id
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = 'trader'
    AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at
  LIMIT 1;

  IF _inv_id IS NOT NULL THEN
    SELECT (public.use_crew_from_inventory(_inv_id, NULL)->>'until')::timestamptz INTO _ends;
    RETURN _ends;
  END IF;

  SELECT price_gems INTO _cost
  FROM public.client_item_prices
  WHERE item_type = 'crew' AND item_id = 'trader';

  IF _cost IS NULL OR _cost <= 0 THEN
    SELECT price_gems INTO _cost
    FROM public.items_catalog
    WHERE code = 'trader_unlock';
  END IF;

  IF _cost IS NULL OR _cost <= 0 THEN
    _cost := 250;
  END IF;

  SELECT gems INTO _bal FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _bal IS NULL OR _bal < _cost THEN
    RAISE EXCEPTION 'جواهر غير كافية';
  END IF;

  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid;

  _ends := now() + interval '10 hours';
  _snap := public.build_trader_snapshot();
  _anchor := public.trader_snapshot_anchor();

  INSERT INTO public.user_market_state(user_id, trader_until, trader_snapshot, trader_anchor)
    VALUES (_uid, _ends, _snap, _anchor)
  ON CONFLICT (user_id) DO UPDATE
    SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
        trader_snapshot = EXCLUDED.trader_snapshot,
        trader_anchor = EXCLUDED.trader_anchor,
        updated_at = now();

  RETURN _ends;
END;
$function$;
