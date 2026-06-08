CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(_fish_id text, _qty integer)
RETURNS TABLE(
  sold integer,
  total_amount bigint,
  effective_unit_price numeric,
  current_price numeric,
  rot numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current_price numeric := 0;
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
  _oldest_caught timestamptz;
  _hours numeric := 0;
  _available integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(NULLIF(fmp.current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices AS fmp
   WHERE fmp.fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  SELECT ums.freeze_until, ums.freeze_started_at
    INTO _freeze_until, _freeze_started_at
    FROM public.user_market_state AS ums
   WHERE ums.user_id = _uid;

  IF _freeze_until IS NOT NULL AND _freeze_until > _now AND _freeze_started_at IS NOT NULL THEN
    _age_end := _freeze_started_at;
  ELSE
    _age_end := _now;
  END IF;

  SELECT MIN(fs.caught_at), COALESCE(SUM(fs.quantity), 0)::integer
    INTO _oldest_caught, _available
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _oldest_caught IS NULL OR _available <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  _hours := GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(_age_end, _oldest_caught) - _oldest_caught)) / 3600.0);
  rot := GREATEST(0.5, 1 - 0.01 * _hours);
  effective_unit_price := GREATEST(0.0001, _current_price * rot);
  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;

  RETURN NEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) TO service_role;