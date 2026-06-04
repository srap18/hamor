
-- Add price history to fish market so past prices on the chart are real
ALTER TABLE public.fish_market_prices
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Rewrite recompute to (1) materialize forecast[0] as new current, (2) shift forecast forward,
-- (3) push the old current into history (keep last 12 hours)
CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  r record;
  base_price numeric; rarity_mult numeric;
  fmin numeric; fmax numeric;
  prev_cur numeric; prev_fc jsonb; prev_hist jsonb;
  next_cur numeric; new_fc jsonb; new_hist jsonb;
  walk numeric; i int;
  crashed boolean;
  hours_to_forecast int := 9;
  history_keep int := 12;
BEGIN
  FOR r IN SELECT fish_id, max_ship_level, rarity_rank FROM public.fish_ship_max_level LOOP
    base_price := 1.0 + ((GREATEST(r.max_ship_level,1) - 1)::numeric / 29.0) * 14.0;
    rarity_mult := 0.90 + (LEAST(GREATEST(r.rarity_rank,1),6) - 1) * (0.25 / 5.0);
    base_price := base_price * rarity_mult;
    fmin := round(base_price * 0.78, 2);
    fmax := round(LEAST(base_price * 1.18, 18)::numeric, 2);
    IF fmin > fmax THEN fmin := fmax; END IF;

    SELECT current_price, forecast, history INTO prev_cur, prev_fc, prev_hist
      FROM public.fish_market_prices WHERE fish_id = r.fish_id;

    -- Materialize: next current = saved forecast[0] (so old prediction comes true)
    IF prev_fc IS NOT NULL AND jsonb_array_length(prev_fc) > 0 THEN
      next_cur := (prev_fc->>0)::numeric;
    ELSE
      next_cur := round((fmin + random()::numeric * (fmax - fmin))::numeric, 2);
    END IF;

    crashed := random() < 0.07;
    IF crashed THEN
      next_cur := round((fmin * 0.55)::numeric, 2);
    END IF;

    IF NOT crashed THEN
      IF next_cur < fmin THEN next_cur := fmin; END IF;
      IF next_cur > fmax THEN next_cur := fmax; END IF;
    END IF;

    -- Append previous current price into history
    new_hist := COALESCE(prev_hist, '[]'::jsonb);
    IF prev_cur IS NOT NULL THEN
      new_hist := new_hist || to_jsonb(round(prev_cur, 2));
    END IF;
    -- Trim to last history_keep
    IF jsonb_array_length(new_hist) > history_keep THEN
      new_hist := (SELECT jsonb_agg(value) FROM (
        SELECT value FROM jsonb_array_elements(new_hist) WITH ORDINALITY t(value, ord)
        ORDER BY ord DESC LIMIT history_keep
      ) s ORDER BY 1);
      -- simpler trim: take last history_keep
      new_hist := (SELECT jsonb_agg(value ORDER BY ord)
                   FROM (
                     SELECT value, ord FROM jsonb_array_elements(COALESCE(prev_hist,'[]'::jsonb) || to_jsonb(round(prev_cur,2))) WITH ORDINALITY t(value, ord)
                   ) s
                   WHERE ord > GREATEST(0, jsonb_array_length(COALESCE(prev_hist,'[]'::jsonb) || to_jsonb(round(prev_cur,2))) - history_keep));
    END IF;

    -- Build new forecast: shift prev forecast forward + append a fresh deterministic step
    new_fc := '[]'::jsonb;
    IF prev_fc IS NOT NULL AND jsonb_array_length(prev_fc) > 1 THEN
      FOR i IN 1..(jsonb_array_length(prev_fc) - 1) LOOP
        new_fc := new_fc || (prev_fc->i);
      END LOOP;
    END IF;

    walk := next_cur;
    IF jsonb_array_length(new_fc) > 0 THEN
      walk := (new_fc->-1)::text::numeric;
    END IF;

    WHILE jsonb_array_length(new_fc) < hours_to_forecast LOOP
      IF crashed AND jsonb_array_length(new_fc) = 0 THEN
        walk := round(((fmin + fmax) / 2)::numeric, 2);
      ELSE
        walk := walk + (random()::numeric - 0.5) * 2 * 0.22 * (fmax - fmin);
      END IF;
      IF walk < fmin THEN walk := fmin; END IF;
      IF walk > fmax THEN walk := fmax; END IF;
      new_fc := new_fc || to_jsonb(round(walk, 2));
    END LOOP;

    INSERT INTO public.fish_market_prices
      (fish_id, min_price, max_price, current_price, trend, last_updated, forecast, history)
    VALUES (r.fish_id, fmin, fmax, next_cur, 0, now(), new_fc, new_hist)
    ON CONFLICT (fish_id) DO UPDATE
      SET min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          current_price = EXCLUDED.current_price,
          trend = CASE WHEN prev_cur IS NULL OR prev_cur = 0 THEN 0
                       ELSE round(((EXCLUDED.current_price - prev_cur) / prev_cur) * 100, 2) END,
          last_updated = now(),
          forecast = EXCLUDED.forecast,
          history = EXCLUDED.history;
  END LOOP;
END $fn$;
