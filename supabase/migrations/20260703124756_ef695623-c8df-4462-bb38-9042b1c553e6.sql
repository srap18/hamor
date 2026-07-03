
-- 1) Fix: market expert should always give the BEST price (max of current market and max cap)
CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(_fish_id text, _qty integer)
 RETURNS TABLE(sold integer, total_amount bigint, effective_unit_price numeric, current_price numeric, rot numeric)
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
  _max_override numeric;
  _unit_base numeric;
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

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    -- Market expert: always take the HIGHER of current market price and the fish's max cap
    _unit_base := GREATEST(_current_price, _max_override);
  ELSE
    _unit_base := _current_price;
  END IF;
  effective_unit_price := GREATEST(0.0001, _unit_base * rot);

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;

  RETURN NEXT;
END;
$function$;

-- 2) Compensation: +1 market_expert crew to every user who ever activated it
WITH affected AS (
  SELECT id AS user_id FROM public.profiles WHERE market_expert_until IS NOT NULL
),
existing AS (
  SELECT a.user_id, i.id AS inv_id
  FROM affected a
  LEFT JOIN LATERAL (
    SELECT id FROM public.inventory
    WHERE user_id = a.user_id AND item_type = 'crew' AND item_id = 'market_expert'
      AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    ORDER BY acquired_at ASC LIMIT 1
  ) i ON true
),
upd AS (
  UPDATE public.inventory inv
     SET quantity = inv.quantity + 1
    FROM existing e
   WHERE inv.id = e.inv_id AND e.inv_id IS NOT NULL
  RETURNING inv.user_id
),
ins AS (
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, acquired_at)
  SELECT e.user_id, 'crew', 'market_expert', 1, now()
    FROM existing e
   WHERE e.inv_id IS NULL
  RETURNING user_id
)
SELECT (SELECT count(*) FROM upd) AS updated, (SELECT count(*) FROM ins) AS inserted;

-- 3) Extend currently-active market_expert by 3 extra hours as apology
UPDATE public.profiles
   SET market_expert_until = market_expert_until + interval '3 hours'
 WHERE market_expert_until IS NOT NULL AND market_expert_until > now();
