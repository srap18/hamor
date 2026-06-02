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
  _current_price numeric := 0;
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
  _remaining integer;
  _row record;
  _take integer;
  _per_fish bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  SELECT COALESCE(NULLIF(current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices
    WHERE fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN
    _current_price := 1;
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

  _remaining := _qty;

  FOR _row IN
    SELECT fs.id, fs.quantity, fs.caught_at
      FROM public.fish_stock fs
      WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0
      ORDER BY fs.caught_at ASC
      FOR UPDATE OF fs
  LOOP
    EXIT WHEN _remaining <= 0;
    _take := LEAST(_row.quantity, _remaining);

    -- Per-fish sale value using current market price × rot multiplier for this row
    _per_fish := GREATEST(1, ROUND(
      _current_price * GREATEST(0.5, 1 - 0.01 * GREATEST(0,
        EXTRACT(EPOCH FROM (GREATEST(_age_end, _row.caught_at) - _row.caught_at)) / 3600.0
      ))
    ))::bigint;

    _total := _total + (_per_fish * _take);
    _sold := _sold + _take;
    _remaining := _remaining - _take;

    IF _take >= _row.quantity THEN
      DELETE FROM public.fish_stock WHERE id = _row.id;
    ELSE
      UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
    END IF;
  END LOOP;

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