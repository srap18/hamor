ALTER TABLE public.fish_market_prices
  ADD COLUMN IF NOT EXISTS forecast jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  base_low numeric; base_high numeric; rarity_mult numeric;
  fmin numeric; fmax numeric; fcur numeric; prev numeric;
  fc jsonb; next_price numeric;
  hours_to_forecast int := 9;
BEGIN
  FOR r IN SELECT fish_id, max_ship_level, rarity_rank FROM public.fish_ship_max_level LOOP
    base_high := 1.03 + ((r.max_ship_level - 1)::numeric / 29.0) * (36.0 - 1.03);
    base_low  := base_high * 0.78;
    rarity_mult := 0.85 + (LEAST(GREATEST(r.rarity_rank,1),6) - 1) * (0.30 / 5.0);
    fmin := round(base_low  * rarity_mult, 2);
    fmax := round(base_high * rarity_mult, 2);
    IF fmax > 36 THEN fmax := 36; END IF;
    IF fmin > fmax THEN fmin := fmax; END IF;

    SELECT current_price, forecast INTO prev, fc
      FROM public.fish_market_prices WHERE fish_id = r.fish_id;

    IF fc IS NOT NULL AND jsonb_typeof(fc) = 'array' AND jsonb_array_length(fc) > 0 THEN
      fcur := (fc->>0)::numeric;
      fc := fc - 0;
    ELSE
      fc := '[]'::jsonb;
      fcur := round((fmin + (random()::numeric) * (fmax - fmin))::numeric, 2);
    END IF;

    IF fcur < fmin THEN fcur := fmin; END IF;
    IF fcur > fmax THEN fcur := fmax; END IF;

    next_price := fcur;
    WHILE jsonb_array_length(fc) < hours_to_forecast LOOP
      next_price := next_price + ((random()::numeric) - 0.5) * 2 * 0.2 * (fmax - fmin);
      IF next_price < fmin THEN next_price := fmin; END IF;
      IF next_price > fmax THEN next_price := fmax; END IF;
      fc := fc || to_jsonb(round(next_price::numeric, 2));
    END LOOP;

    INSERT INTO public.fish_market_prices
      (fish_id, min_price, max_price, current_price, trend, last_updated, forecast)
    VALUES (r.fish_id, fmin, fmax, fcur, 0, now(), fc)
    ON CONFLICT (fish_id) DO UPDATE
      SET min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          current_price = EXCLUDED.current_price,
          trend = CASE WHEN prev IS NULL OR prev = 0 THEN 0
                       ELSE round(((EXCLUDED.current_price - prev) / prev) * 100, 2) END,
          last_updated = now(),
          forecast = EXCLUDED.forecast;
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-fish-prices') THEN
    PERFORM cron.unschedule('recompute-fish-prices');
  END IF;
END $$;
SELECT cron.schedule('recompute-fish-prices', '0 * * * *', $$SELECT public.recompute_fish_prices();$$);

SELECT public.recompute_fish_prices();