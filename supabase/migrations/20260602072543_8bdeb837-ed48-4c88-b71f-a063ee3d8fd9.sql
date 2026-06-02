CREATE OR REPLACE FUNCTION public.sell_fish(_fish_stock_ids uuid[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _xp_gain integer := 0;
  _sold_counts jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF COALESCE(array_length(_fish_stock_ids, 1), 0) = 0 THEN RETURN 0; END IF;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  ), mine AS (
    SELECT
      fs.id,
      fs.fish_id,
      GREATEST(1, COALESCE(NULLIF(fs.base_value, 0), fmp.current_price::bigint, 1)) AS sale_value
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    LEFT JOIN public.fish_market_prices fmp ON fmp.fish_id = fs.fish_id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(SUM(sale_value), 0)
    INTO _total
  FROM mine;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  ), mine AS (
    SELECT fs.id, fs.fish_id
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(jsonb_object_agg(fish_id, cnt), '{}'::jsonb)
    INTO _sold_counts
  FROM (
    SELECT fish_id, COUNT(*)::int AS cnt
    FROM mine
    GROUP BY fish_id
  ) s;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  )
  DELETE FROM public.fish_stock fs
  USING requested r
  WHERE fs.id = r.id AND fs.user_id = _uid;

  IF _sold_counts IS NOT NULL AND _sold_counts <> '{}'::jsonb THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    SELECT _uid, key, 0, (value)::int
      FROM jsonb_each_text(_sold_counts)
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
$$;

REVOKE ALL ON FUNCTION public.sell_fish(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_fish(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_fish(uuid[]) TO service_role;