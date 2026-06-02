
-- 1) Consolidate fish_stock rows per (user_id, fish_id, hour) to drastically reduce row count
DO $$
BEGIN
  CREATE TEMP TABLE _fs_consol AS
  SELECT user_id, fish_id,
         date_trunc('hour', caught_at) AS hour_bucket,
         SUM(quantity)::int AS quantity,
         MIN(caught_at) AS caught_at
    FROM public.fish_stock
   WHERE quantity > 0
   GROUP BY 1,2,3
  HAVING COUNT(*) > 1 OR SUM(quantity) <> MAX(quantity);

  -- Delete originals only where we will replace
  DELETE FROM public.fish_stock fs
   USING _fs_consol c
   WHERE fs.user_id = c.user_id
     AND fs.fish_id = c.fish_id
     AND date_trunc('hour', fs.caught_at) = c.hour_bucket;

  INSERT INTO public.fish_stock(user_id, fish_id, quantity, caught_at)
  SELECT user_id, fish_id, quantity, caught_at FROM _fs_consol;

  DROP TABLE _fs_consol;
END $$;

-- 2) Rewrite sell_fish_by_qty as a set-based query
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
  _xp_gain integer := 0;
  _current_price numeric := 0;
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  -- Prevent concurrent sells for same user+fish
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

  WITH ordered AS (
    SELECT id, quantity, caught_at,
           SUM(quantity) OVER (ORDER BY caught_at ASC, id ASC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
      FROM public.fish_stock
     WHERE user_id = _uid AND fish_id = _fish_id AND quantity > 0
  ),
  picked AS (
    SELECT id, quantity, caught_at,
           LEAST(quantity, GREATEST(0, _qty - (cum - quantity)))::int AS take
      FROM ordered
     WHERE cum - quantity < _qty
  ),
  priced AS (
    SELECT id, quantity, take,
      GREATEST(1, ROUND(
        _current_price * GREATEST(0.5, 1 - 0.01 * GREATEST(0,
          EXTRACT(EPOCH FROM (GREATEST(_age_end, caught_at) - caught_at)) / 3600.0
        ))
      ))::bigint AS per_fish
      FROM picked
     WHERE take > 0
  ),
  del AS (
    DELETE FROM public.fish_stock fs
      USING priced p
     WHERE fs.id = p.id AND p.take >= p.quantity
    RETURNING fs.id
  ),
  upd AS (
    UPDATE public.fish_stock fs
       SET quantity = fs.quantity - p.take
      FROM priced p
     WHERE fs.id = p.id AND p.take > 0 AND p.take < p.quantity
    RETURNING fs.id
  )
  SELECT COALESCE(SUM(per_fish * take), 0)::bigint,
         COALESCE(SUM(take), 0)::int
    INTO _total, _sold
    FROM priced;

  IF _sold > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _fish_id, 0, _sold)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                  updated_at = now();
  END IF;

  IF _total > 0 THEN
    _xp_gain := LEAST(200, GREATEST(1, (_total / 250)::int));
    PERFORM public._mutate_currency(_uid, _total, 0, 0, _xp_gain);
  END IF;

  RETURN _total;
END;
$function$;
