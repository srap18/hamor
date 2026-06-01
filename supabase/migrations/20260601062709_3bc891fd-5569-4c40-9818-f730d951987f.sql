
-- 1) Per-user market state (trader unlock + market freeze with snapshot)
CREATE TABLE IF NOT EXISTS public.user_market_state (
  user_id uuid PRIMARY KEY,
  trader_until timestamptz,
  freeze_until timestamptz,
  frozen_prices jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_market_state TO authenticated;
GRANT ALL ON public.user_market_state TO service_role;

ALTER TABLE public.user_market_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ums_select_own ON public.user_market_state;
CREATE POLICY ums_select_own ON public.user_market_state FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS ums_insert_own ON public.user_market_state;
CREATE POLICY ums_insert_own ON public.user_market_state FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS ums_update_own ON public.user_market_state;
CREATE POLICY ums_update_own ON public.user_market_state FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2) Buy trader: 250 gems unlocks 10h accurate forecast across whole market
CREATE OR REPLACE FUNCTION public.buy_trader_unlock()
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _cost int := 250;
  _ends timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;
  _ends := now() + interval '10 hours';
  INSERT INTO public.user_market_state(user_id, trader_until)
    VALUES (_uid, _ends)
  ON CONFLICT (user_id) DO UPDATE
    SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
        updated_at = now();
  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
    VALUES (_uid, 'trader_unlock', -_cost, 'gems', jsonb_build_object('hours', 10));
  RETURN _ends;
END $fn$;

-- 3) Buy market freeze: snapshots current prices+forecasts for whole market
CREATE OR REPLACE FUNCTION public.buy_market_freeze(_hours int)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _ends timestamptz;
  _snap jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;
  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;
  SELECT COALESCE(jsonb_object_agg(fish_id, jsonb_build_object(
    'current', current_price, 'min', min_price, 'max', max_price, 'forecast', forecast
  )), '{}'::jsonb) INTO _snap FROM public.fish_market_prices;
  _ends := now() + (_hours || ' hours')::interval;
  INSERT INTO public.user_market_state(user_id, freeze_until, frozen_prices)
    VALUES (_uid, _ends, _snap)
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_until = EXCLUDED.freeze_until,
        frozen_prices = EXCLUDED.frozen_prices,
        updated_at = now();
  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
    VALUES (_uid, 'market_freeze', -_cost, 'gems', jsonb_build_object('hours', _hours));
  RETURN _ends;
END $fn$;

GRANT EXECUTE ON FUNCTION public.buy_trader_unlock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_market_freeze(int) TO authenticated;

-- 4) Rewrite hourly recompute so forecast materializes exactly + random crash + recovery walk
CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  r record;
  base_price numeric; rarity_mult numeric;
  fmin numeric; fmax numeric;
  prev_cur numeric; prev_fc jsonb;
  next_cur numeric; new_fc jsonb;
  walk numeric; i int;
  crashed boolean;
  hours_to_forecast int := 9;
BEGIN
  FOR r IN SELECT fish_id, max_ship_level, rarity_rank FROM public.fish_ship_max_level LOOP
    base_price := 1.0 + ((GREATEST(r.max_ship_level,1) - 1)::numeric / 29.0) * 14.0;
    rarity_mult := 0.90 + (LEAST(GREATEST(r.rarity_rank,1),6) - 1) * (0.25 / 5.0);
    base_price := base_price * rarity_mult;
    fmin := round(base_price * 0.78, 2);
    fmax := round(LEAST(base_price * 1.18, 18)::numeric, 2);
    IF fmin > fmax THEN fmin := fmax; END IF;

    SELECT current_price, forecast INTO prev_cur, prev_fc
      FROM public.fish_market_prices WHERE fish_id = r.fish_id;

    -- Materialize: next current = saved forecast[0] (so old prediction comes true)
    IF prev_fc IS NOT NULL AND jsonb_array_length(prev_fc) > 0 THEN
      next_cur := (prev_fc->>0)::numeric;
    ELSE
      next_cur := round((fmin + random()::numeric * (fmax - fmin))::numeric, 2);
    END IF;

    -- 7% random crash event (below min, recovers later)
    crashed := random() < 0.07;
    IF crashed THEN
      next_cur := round((fmin * 0.55)::numeric, 2);
    END IF;

    IF NOT crashed THEN
      IF next_cur < fmin THEN next_cur := fmin; END IF;
      IF next_cur > fmax THEN next_cur := fmax; END IF;
    END IF;

    -- Build new forecast: shift prev forecast forward + append a fresh deterministic step
    new_fc := '[]'::jsonb;
    IF prev_fc IS NOT NULL AND jsonb_array_length(prev_fc) > 1 THEN
      FOR i IN 1..(jsonb_array_length(prev_fc) - 1) LOOP
        new_fc := new_fc || (prev_fc->i);
      END LOOP;
    END IF;

    -- After crash, force recovery on the first appended forecast point
    walk := next_cur;
    IF jsonb_array_length(new_fc) > 0 THEN
      walk := (new_fc->-1)::text::numeric;
    END IF;

    WHILE jsonb_array_length(new_fc) < hours_to_forecast LOOP
      IF crashed AND jsonb_array_length(new_fc) = 0 THEN
        walk := round(((fmin + fmax) / 2)::numeric, 2); -- bounce back to mid next hour
      ELSE
        walk := walk + (random()::numeric - 0.5) * 2 * 0.22 * (fmax - fmin);
      END IF;
      IF walk < fmin THEN walk := fmin; END IF;
      IF walk > fmax THEN walk := fmax; END IF;
      new_fc := new_fc || to_jsonb(round(walk, 2));
    END LOOP;

    INSERT INTO public.fish_market_prices
      (fish_id, min_price, max_price, current_price, trend, last_updated, forecast)
    VALUES (r.fish_id, fmin, fmax, next_cur, 0, now(), new_fc)
    ON CONFLICT (fish_id) DO UPDATE
      SET min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          current_price = EXCLUDED.current_price,
          trend = CASE WHEN prev_cur IS NULL OR prev_cur = 0 THEN 0
                       ELSE round(((EXCLUDED.current_price - prev_cur) / prev_cur) * 100, 2) END,
          last_updated = now(),
          forecast = EXCLUDED.forecast;
  END LOOP;
END $fn$;

-- Run once so the new forecast walk is in place
SELECT public.recompute_fish_prices();
