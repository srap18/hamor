CREATE OR REPLACE FUNCTION public.sell_fish_by_qty(_fish_id text, _qty integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _xp_gain integer := 0;
  _sold integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  WITH picked AS (
    SELECT fs.id, GREATEST(1, COALESCE(NULLIF(fs.base_value, 0), fmp.current_price::bigint, 1)) AS sale_value
    FROM public.fish_stock fs
    LEFT JOIN public.fish_market_prices fmp ON fmp.fish_id = fs.fish_id
    WHERE fs.user_id = _uid AND fs.fish_id = _fish_id
    ORDER BY fs.caught_at ASC
    LIMIT _qty
    FOR UPDATE OF fs
  ), del AS (
    DELETE FROM public.fish_stock fs
    USING picked p
    WHERE fs.id = p.id
    RETURNING p.sale_value
  )
  SELECT COALESCE(SUM(sale_value), 0), COUNT(*)
    INTO _total, _sold
  FROM del;

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

GRANT EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) TO authenticated;