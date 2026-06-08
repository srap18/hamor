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
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
  _oldest_caught timestamptz;
  _hours numeric := 0;
  _rot numeric := 1;
  _unit_price bigint := 1;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':' || _fish_id, 0));

  SELECT COALESCE(NULLIF(current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices
   WHERE fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  SELECT freeze_until, freeze_started_at
    INTO _freeze_until, _freeze_started_at
    FROM public.user_market_state
   WHERE user_id = _uid;

  IF _freeze_until IS NOT NULL AND _freeze_until > _now AND _freeze_started_at IS NOT NULL THEN
    _age_end := _freeze_started_at;
  ELSE
    _age_end := _now;
  END IF;

  -- Use the OLDEST fish's age to derive a single unified rot multiplier,
  -- matching the client's displayed price exactly.
  SELECT MIN(caught_at) INTO _oldest_caught
    FROM public.fish_stock
   WHERE user_id = _uid AND fish_id = _fish_id AND quantity > 0;

  IF _oldest_caught IS NULL THEN RETURN 0; END IF;

  _hours := GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(_age_end, _oldest_caught) - _oldest_caught)) / 3600.0);
  _rot := GREATEST(0.5, 1 - 0.01 * _hours);
  _unit_price := GREATEST(1, ROUND(_current_price * _rot))::bigint;

  WITH ordered AS (
    SELECT id, quantity, caught_at,
           SUM(quantity) OVER (ORDER BY caught_at ASC, id ASC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
      FROM public.fish_stock
     WHERE user_id = _uid AND fish_id = _fish_id AND quantity > 0
  ),
  picked AS (
    SELECT id, quantity,
           LEAST(quantity, GREATEST(0, _qty - (cum - quantity)))::int AS take
      FROM ordered
     WHERE cum - quantity < _qty
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

  _total := _unit_price * _sold;

  IF _sold > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _fish_id, 0, _sold)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                  updated_at = now();
  END IF;

  IF _total > 0 THEN
    PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
  END IF;

  RETURN _total;
END;
$function$;