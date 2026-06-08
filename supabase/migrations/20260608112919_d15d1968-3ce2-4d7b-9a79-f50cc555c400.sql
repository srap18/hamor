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

  SELECT COALESCE(NULLIF(current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices
   WHERE fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  SELECT freeze_until, freeze_started_at
    INTO _freeze_until, _freeze_started_at
    FROM public.user_market_state
   WHERE user_id = _uid;

  IF _freeze_until IS NOT NULL AND _freeze_until > _now AND _freeze_started_at IS NOT NULL THEN
    _age_end := _freeze_started_at;
  ELSE
    _age_end := _now;
  END IF;

  SELECT MIN(caught_at), COALESCE(SUM(quantity), 0)::integer
    INTO _oldest_caught, _available
    FROM public.fish_stock
   WHERE user_id = _uid AND fish_id = _fish_id AND quantity > 0;

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

GRANT EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.sell_fish_by_qty(_fish_id text, _qty integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _sold integer := 0;
  _current_price numeric := 0;
  _rot numeric := 1;
  _effective_unit_price numeric := 0;
  _balance_before bigint := 0;
  _balance_after bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  PERFORM public._enforce_rate_limit('sell_fish', 500);
  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':' || _fish_id, 0));

  SELECT q.sold, q.total_amount, q.effective_unit_price, q.current_price, q.rot
    INTO _sold, _total, _effective_unit_price, _current_price, _rot
    FROM public.quote_fish_sale_by_qty(_fish_id, _qty) q;

  IF COALESCE(_sold, 0) <= 0 OR COALESCE(_total, 0) <= 0 THEN RETURN 0; END IF;

  WITH ordered AS (
    SELECT id, quantity, caught_at,
           SUM(quantity) OVER (ORDER BY caught_at ASC, id ASC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
      FROM public.fish_stock
     WHERE user_id = _uid AND fish_id = _fish_id AND quantity > 0
  ),
  picked AS (
    SELECT id, quantity,
           LEAST(quantity, GREATEST(0, _sold - (cum - quantity)))::int AS take
      FROM ordered
     WHERE cum - quantity < _sold
  ),
  del AS (
    DELETE FROM public.fish_stock fs
      USING picked p
     WHERE fs.id = p.id AND p.take >= p.quantity
    RETURNING fs.id
  ),
  upd AS (
    UPDATE public.fish_stock fs
       SET quantity = fs.quantity - p.take
      FROM picked p
     WHERE fs.id = p.id AND p.take > 0 AND p.take < p.quantity
    RETURNING fs.id
  )
  SELECT COALESCE(SUM(take), 0)::int
    INTO _sold
    FROM picked
   WHERE take > 0;

  IF COALESCE(_sold, 0) <= 0 THEN RETURN 0; END IF;
  _total := GREATEST(0, ROUND(_effective_unit_price * _sold))::bigint;
  IF _total <= 0 THEN RETURN 0; END IF;

  SELECT coins INTO _balance_before
    FROM public.profiles
   WHERE id = _uid
   FOR UPDATE;

  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _fish_id, 0, _sold)
  ON CONFLICT (user_id, fish_id)
  DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                updated_at = now();

  PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
  _balance_after := _balance_before + _total;

  IF _total >= 100000 THEN
    INSERT INTO public.transaction_logs(
      user_id,
      kind,
      item_id,
      quantity,
      unit_price,
      total_amount,
      balance_before,
      balance_after,
      meta
    ) VALUES (
      _uid,
      'fish_sale',
      _fish_id,
      _sold,
      GREATEST(0, ROUND(_effective_unit_price))::bigint,
      _total,
      _balance_before,
      _balance_after,
      jsonb_build_object(
        'requested_qty', _qty,
        'current_price', _current_price,
        'rot', _rot,
        'effective_unit_price', _effective_unit_price
      )
    );
  END IF;

  RETURN _total;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) TO service_role;