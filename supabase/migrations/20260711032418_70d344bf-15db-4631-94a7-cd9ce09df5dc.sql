
-- Helper: authoritative admin bounds for a fish (fps overrides fmp)
CREATE OR REPLACE FUNCTION public._fish_price_bounds(_fish_id text)
RETURNS TABLE(min_p numeric, max_p numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE(fps.min_price, fmp.min_price, 0.0001)::numeric AS min_p,
    COALESCE(fps.max_price, fmp.max_price, 999999999)::numeric AS max_p
  FROM (SELECT 1) x
  LEFT JOIN public.fish_price_settings fps ON fps.fish_id = _fish_id
  LEFT JOIN public.fish_market_prices  fmp ON fmp.fish_id = _fish_id;
$$;

-- Market-expert cap must never exceed the admin max
CREATE OR REPLACE FUNCTION public._market_expert_max_price(_uid uuid, _fish_id text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p.market_expert_until IS NOT NULL AND p.market_expert_until > now()
    THEN LEAST(
      COALESCE((SELECT fps.max_price FROM public.fish_price_settings fps WHERE fps.fish_id = _fish_id), 999999999)::numeric,
      COALESCE((SELECT fmp.max_price FROM public.fish_market_prices  fmp WHERE fmp.fish_id = _fish_id), 999999999)::numeric
    )
    ELSE NULL
  END
  FROM public.profiles p WHERE p.id = _uid;
$$;

-- sell_fish: clamp per-unit value between admin min and max
CREATE OR REPLACE FUNCTION public.sell_fish(_fish_stock_ids uuid[])
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _sold_counts jsonb;
  _coins_before bigint;
  _coins_after bigint;
  _qty_total bigint := 0;
  _audit_threshold bigint := 100000;
  _expert_active boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF COALESCE(array_length(_fish_stock_ids, 1), 0) = 0 THEN RETURN 0; END IF;

  PERFORM public._enforce_rate_limit('sell_fish', 500);
  PERFORM public._detect_bot_and_ban(_uid, 'sell_fish');
  IF EXISTS (SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
             AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT (market_expert_until IS NOT NULL AND market_expert_until > now())
    INTO _expert_active FROM public.profiles WHERE id = _uid;
  _expert_active := COALESCE(_expert_active, false);

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id),
  mine AS (
    SELECT fs.id, fs.fish_id, fs.quantity,
      GREATEST(
        COALESCE(fps.min_price, fmp.min_price, 1)::numeric,
        LEAST(
          COALESCE(fps.max_price, fmp.max_price, 999999999)::numeric,
          CASE
            WHEN _expert_active AND COALESCE(fps.max_price, fmp.max_price) IS NOT NULL
              THEN COALESCE(fps.max_price, fmp.max_price)::numeric
            ELSE GREATEST(1, COALESCE(NULLIF(fs.base_value, 0), fmp.current_price::bigint, 1))::numeric
          END
        )
      )::bigint AS unit_value
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    LEFT JOIN public.fish_market_prices  fmp ON fmp.fish_id = fs.fish_id
    LEFT JOIN public.fish_price_settings fps ON fps.fish_id = fs.fish_id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(SUM(unit_value * quantity), 0), COALESCE(SUM(quantity), 0)
    INTO _total, _qty_total FROM mine;

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id),
  mine AS (
    SELECT fs.id, fs.fish_id, fs.quantity FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id WHERE fs.user_id = _uid FOR UPDATE OF fs
  )
  SELECT COALESCE(jsonb_object_agg(fish_id, cnt), '{}'::jsonb) INTO _sold_counts
  FROM (SELECT fish_id, SUM(quantity)::int AS cnt FROM mine GROUP BY fish_id) s;

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id)
  DELETE FROM public.fish_stock fs USING requested r
  WHERE fs.id = r.id AND fs.user_id = _uid;

  IF _sold_counts IS NOT NULL AND _sold_counts <> '{}'::jsonb THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    SELECT _uid, key, 0, (value)::int FROM jsonb_each_text(_sold_counts)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                  updated_at = now();
  END IF;

  IF _total > 0 THEN
    SELECT COALESCE(coins, 0) INTO _coins_before FROM public.profiles WHERE id = _uid;
    PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
    SELECT COALESCE(coins, 0) INTO _coins_after FROM public.profiles WHERE id = _uid;
    IF _total >= _audit_threshold THEN
      INSERT INTO public.transaction_logs(
        user_id, kind, item_id, quantity, unit_price,
        total_amount, balance_before, balance_after, meta
      ) VALUES (
        _uid, 'sell_fish', NULL, _qty_total,
        CASE WHEN _qty_total > 0 THEN (_total / _qty_total) ELSE 0 END,
        _total, _coins_before, _coins_after,
        jsonb_build_object('sold_counts', _sold_counts, 'stock_ids_count', array_length(_fish_stock_ids,1), 'market_expert', _expert_active)
      );
    END IF;
    PERFORM public._record_fish_sale_gold(_uid, _total);
  END IF;

  RETURN _total;
END;
$$;

-- sell_fish_caught: clamp _final_unit strictly within admin bounds
CREATE OR REPLACE FUNCTION public.sell_fish_caught(_fish_id text, _qty integer, _unit_price numeric DEFAULT NULL::numeric)
RETURNS TABLE(remaining integer, coins_earned bigint, new_coins bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _have integer; _sell integer; _earned bigint; _new_coins bigint; _remaining integer;
  _market_price numeric; _caught_at timestamptz;
  _freeze_started timestamptz; _freeze_until timestamptz;
  _age_end timestamptz; _hours numeric; _rot numeric;
  _final_unit numeric; _max_override numeric;
  _min_bound numeric; _max_bound numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'invalid qty'; END IF;

  SELECT quantity, updated_at INTO _have, _caught_at
  FROM public.fish_caught WHERE user_id = _uid AND fish_id = _fish_id FOR UPDATE;
  IF _have IS NULL OR _have <= 0 THEN RAISE EXCEPTION 'no fish to sell'; END IF;

  SELECT current_price INTO _market_price FROM public.fish_market_prices WHERE fish_id = _fish_id;
  IF _market_price IS NULL OR _market_price <= 0 THEN
    _market_price := GREATEST(0.1, COALESCE(_unit_price, 0.1));
  END IF;

  SELECT min_p, max_p INTO _min_bound, _max_bound FROM public._fish_price_bounds(_fish_id);

  SELECT freeze_started_at, freeze_until INTO _freeze_started, _freeze_until
  FROM public.user_market_state WHERE user_id = _uid;
  _age_end := now();
  IF _freeze_started IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > now() THEN
    _age_end := GREATEST(_caught_at, _freeze_started);
  END IF;
  _hours := GREATEST(0, EXTRACT(EPOCH FROM (_age_end - _caught_at)) / 3600.0);
  _rot := GREATEST(0.5, 1 - (0.01 * _hours));

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    _final_unit := _max_override;
    _rot := 1::numeric;
  ELSE
    _final_unit := round((_market_price * _rot)::numeric, 2);
  END IF;

  -- Strict admin bounds
  _final_unit := GREATEST(_min_bound, LEAST(_max_bound, _final_unit));

  _sell := LEAST(_qty, _have);
  _remaining := _have - _sell;
  _earned := (_sell::numeric * _final_unit)::bigint;

  IF _remaining > 0 THEN
    UPDATE public.fish_caught SET quantity = _remaining WHERE user_id = _uid AND fish_id = _fish_id;
  ELSE
    DELETE FROM public.fish_caught WHERE user_id = _uid AND fish_id = _fish_id;
  END IF;

  UPDATE public.profiles SET coins = coins + _earned WHERE id = _uid RETURNING coins INTO _new_coins;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'fish_sale', _earned, 'coins', jsonb_build_object(
    'fish_id', _fish_id, 'qty', _sell, 'unit_price', _final_unit,
    'quality_pct', round((_rot * 100)::numeric, 2),
    'server_priced', true, 'market_expert', _max_override IS NOT NULL,
    'bounds_min', _min_bound, 'bounds_max', _max_bound
  ));

  PERFORM public._record_fish_sale_gold(_uid, _earned);
  remaining := _remaining; coins_earned := _earned; new_coins := _new_coins;
  RETURN NEXT;
END;
$$;

-- quote_fish_sale_by_qty: clamp effective_unit_price to admin bounds
CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(_fish_id text, _qty integer)
RETURNS TABLE(sold integer, total_amount bigint, effective_unit_price numeric, current_price numeric, rot numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  SELECT ums.freeze_until, ums.freeze_started_at, COALESCE(ums.rot_freeze_offset_seconds, 0)
    INTO _freeze_until, _freeze_started_at, _offset_seconds
    FROM public.user_market_state AS ums WHERE ums.user_id = _uid;

  SELECT MIN(fs.caught_at), COALESCE(SUM(fs.quantity), 0)::integer
    INTO _oldest_caught, _available
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _oldest_caught IS NULL OR _available <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric; RETURN;
  END IF;

  IF _freeze_started_at IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > _freeze_started_at THEN
    _freeze_used_seconds := GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(_freeze_until, _now) - GREATEST(_freeze_started_at, _oldest_caught)
    )));
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

  -- Strict admin bounds
  effective_unit_price := GREATEST(_min_bound, LEAST(_max_bound, effective_unit_price));

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;
  RETURN NEXT;
END;
$$;

-- recompute_fish_prices: always clamp next_cur to current admin bounds
CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  base_price numeric; rarity_mult numeric;
  fmin numeric; fmax numeric;
  ovr_min numeric; ovr_max numeric; ovr_hc numeric;
  prev_cur numeric; prev_fc jsonb; prev_hist jsonb; prev_last timestamptz;
  next_cur numeric; new_fc jsonb; new_hist jsonb;
  walk numeric; delta numeric; i int;
  appended_crash boolean;
  hours_to_forecast int := 9;
  history_keep int := 12;
  current_hour timestamptz := date_trunc('hour', now());
BEGIN
  FOR r IN SELECT fish_id, max_ship_level, rarity_rank FROM public.fish_ship_max_level LOOP
    base_price := 1.0 + ((GREATEST(r.max_ship_level,1) - 1)::numeric / 29.0) * 14.0;
    rarity_mult := 0.90 + (LEAST(GREATEST(r.rarity_rank,1),6) - 1) * (0.25 / 5.0);
    base_price := base_price * rarity_mult;
    fmin := round(base_price * 0.78, 2);
    fmax := round(LEAST(base_price * 1.18, 18)::numeric, 2);
    IF fmin > fmax THEN fmin := fmax; END IF;

    SELECT min_price, max_price, max_hourly_change
      INTO ovr_min, ovr_max, ovr_hc
      FROM public.fish_price_settings WHERE fish_id = r.fish_id;
    IF ovr_min IS NOT NULL THEN
      fmin := ovr_min; fmax := ovr_max;
      IF fmin > fmax THEN fmin := fmax; END IF;
    END IF;

    SELECT current_price, forecast, history, last_updated
      INTO prev_cur, prev_fc, prev_hist, prev_last
      FROM public.fish_market_prices WHERE fish_id = r.fish_id;

    IF prev_last IS NOT NULL AND date_trunc('hour', prev_last) >= current_hour THEN
      CONTINUE;
    END IF;

    IF prev_fc IS NOT NULL AND jsonb_array_length(prev_fc) > 0 THEN
      next_cur := (prev_fc->>0)::numeric;
    ELSE
      next_cur := round((fmin + random()::numeric * (fmax - fmin))::numeric, 2);
      IF ovr_hc IS NOT NULL AND prev_cur IS NOT NULL THEN
        IF next_cur - prev_cur > ovr_hc THEN next_cur := round((prev_cur + ovr_hc)::numeric, 2); END IF;
        IF prev_cur - next_cur > ovr_hc THEN next_cur := round((prev_cur - ovr_hc)::numeric, 2); END IF;
      END IF;
    END IF;
    -- ALWAYS clamp to admin bounds — never leak outside min/max even from stale forecast
    IF next_cur < fmin THEN next_cur := fmin; END IF;
    IF next_cur > fmax THEN next_cur := fmax; END IF;

    new_hist := COALESCE(prev_hist, '[]'::jsonb);
    IF prev_cur IS NOT NULL THEN
      new_hist := new_hist || to_jsonb(round(prev_cur, 2));
    END IF;
    IF jsonb_array_length(new_hist) > history_keep THEN
      new_hist := (SELECT jsonb_agg(value ORDER BY ord) FROM (
        SELECT value, ord FROM jsonb_array_elements(new_hist) WITH ORDINALITY t(value, ord)
      ) s WHERE ord > jsonb_array_length(new_hist) - history_keep);
    END IF;

    new_fc := '[]'::jsonb;
    IF prev_fc IS NOT NULL AND jsonb_array_length(prev_fc) > 1 THEN
      FOR i IN 1..(jsonb_array_length(prev_fc) - 1) LOOP
        -- Clamp any preserved forecast value into new bounds too
        new_fc := new_fc || to_jsonb(GREATEST(fmin, LEAST(fmax, (prev_fc->>i)::numeric)));
      END LOOP;
    END IF;

    IF jsonb_array_length(new_fc) > 0 THEN
      walk := (new_fc->-1)::text::numeric;
    ELSE
      walk := next_cur;
    END IF;

    WHILE jsonb_array_length(new_fc) < hours_to_forecast LOOP
      appended_crash := (ovr_hc IS NULL) AND (random() < 0.05);
      IF appended_crash THEN
        delta := round((fmin * 0.55)::numeric, 2) - walk;
      ELSE
        delta := (random()::numeric - 0.5) * 2 * 0.22 * (fmax - fmin);
      END IF;
      IF ovr_hc IS NOT NULL THEN
        IF delta > ovr_hc THEN delta := ovr_hc; END IF;
        IF delta < -ovr_hc THEN delta := -ovr_hc; END IF;
      END IF;
      walk := walk + delta;
      IF walk < fmin THEN walk := fmin; END IF;
      IF walk > fmax THEN walk := fmax; END IF;
      new_fc := new_fc || to_jsonb(round(walk, 2));
    END LOOP;

    INSERT INTO public.fish_market_prices
      (fish_id, min_price, max_price, current_price, trend, last_updated, forecast, history)
    VALUES (r.fish_id, fmin, fmax, next_cur, 0, current_hour, new_fc, new_hist)
    ON CONFLICT (fish_id) DO UPDATE
      SET min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          current_price = EXCLUDED.current_price,
          trend = CASE WHEN prev_cur IS NULL OR prev_cur = 0 THEN 0
                       ELSE round(((EXCLUDED.current_price - prev_cur) / prev_cur) * 100, 2) END,
          last_updated = current_hour,
          forecast = EXCLUDED.forecast,
          history = EXCLUDED.history;
  END LOOP;
END $$;

-- Immediate clamp of any currently-stored prices/forecasts to their admin bounds
UPDATE public.fish_market_prices fmp
   SET current_price = LEAST(GREATEST(fmp.current_price, fmp.min_price), fmp.max_price)
 WHERE fmp.current_price < fmp.min_price OR fmp.current_price > fmp.max_price;
