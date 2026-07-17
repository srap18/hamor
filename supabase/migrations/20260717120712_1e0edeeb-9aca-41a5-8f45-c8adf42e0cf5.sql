CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(
  _fish_id text,
  _qty integer
) RETURNS TABLE(sold integer, total_amount bigint, effective_unit_price numeric, current_price numeric, rot numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _current_price numeric := 0;
  _freeze_until timestamptz; _freeze_started_at timestamptz;
  _offset_seconds bigint := 0; _now timestamptz := now();
  _oldest_caught timestamptz; _hours numeric := 0;
  _available integer := 0; _max_override numeric;
  _unit_base numeric;
  _freeze_used_seconds numeric := 0; _elapsed_seconds numeric := 0;
  _min_bound numeric; _max_bound numeric;
  _frozen_prices jsonb;
  _frozen_price numeric;
  _freeze_active boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(NULLIF(fmp.current_price, 0), 1) INTO _current_price
    FROM public.fish_market_prices AS fmp WHERE fmp.fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  SELECT min_p, max_p INTO _min_bound, _max_bound FROM public._fish_price_bounds(_fish_id);
  _current_price := GREATEST(_min_bound, LEAST(_max_bound, _current_price));

  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric; RETURN;
  END IF;

  SELECT ums.freeze_until, ums.freeze_started_at, COALESCE(ums.rot_freeze_offset_seconds, 0), COALESCE(ums.frozen_prices, '{}'::jsonb)
    INTO _freeze_until, _freeze_started_at, _offset_seconds, _frozen_prices
    FROM public.user_market_state AS ums WHERE ums.user_id = _uid;

  _freeze_active := (_freeze_until IS NOT NULL AND _freeze_until > _now);

  IF _freeze_active AND _frozen_prices ? _fish_id THEN
    _frozen_price := GREATEST(_min_bound, LEAST(_max_bound, (_frozen_prices ->> _fish_id)::numeric));
  ELSE
    _frozen_price := NULL;
  END IF;

  SELECT COALESCE(SUM(fs.quantity), 0), MIN(fs.caught_at)
    INTO _available, _oldest_caught
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _available <= 0 OR _oldest_caught IS NULL THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric; RETURN;
  END IF;

  IF _freeze_started_at IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > _freeze_started_at THEN
    _freeze_used_seconds := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_freeze_until, _now) - GREATEST(_freeze_started_at, _oldest_caught))));
  END IF;

  _elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (_now - _oldest_caught)) - COALESCE(_offset_seconds, 0) - _freeze_used_seconds);
  _hours := _elapsed_seconds / 3600.0;
  rot := GREATEST(0.5, 1 - 0.01 * _hours);

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    _unit_base := _max_override;
  ELSE
    _unit_base := _current_price;
  END IF;

  effective_unit_price := _unit_base * rot;

  IF _frozen_price IS NOT NULL THEN
    effective_unit_price := GREATEST(effective_unit_price, _frozen_price);
  END IF;

  effective_unit_price := GREATEST(0, LEAST(_max_bound, effective_unit_price));

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;
  RETURN NEXT;
END;
$$;