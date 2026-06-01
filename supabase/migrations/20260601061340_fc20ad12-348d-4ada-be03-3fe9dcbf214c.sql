CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  base_price numeric; base_low numeric; base_high numeric; rarity_mult numeric;
  fmin numeric; fmax numeric; fcur numeric; prev numeric;
  fc jsonb; next_price numeric;
  hours_to_forecast int := 9;
BEGIN
  FOR r IN SELECT fish_id, max_ship_level, rarity_rank FROM public.fish_ship_max_level LOOP
    -- New balanced curve: ship level 1 -> ~1 coin, level 30 -> ~15 coins
    base_price := 1.0 + ((GREATEST(r.max_ship_level,1) - 1)::numeric / 29.0) * 14.0;
    -- Subtle rarity multiplier: 0.90 .. 1.15
    rarity_mult := 0.90 + (LEAST(GREATEST(r.rarity_rank,1),6) - 1) * (0.25 / 5.0);
    base_price := base_price * rarity_mult;
    -- Tight band so prices stay reasonable
    base_low  := round(base_price * 0.78, 2);
    base_high := round(base_price * 1.18, 2);
    fmin := base_low;
    fmax := base_high;
    IF fmax > 18 THEN fmax := 18; END IF;
    IF fmin > fmax THEN fmin := fmax; END IF;

    SELECT current_price, forecast INTO prev, fc
      FROM public.fish_market_prices WHERE fish_id = r.fish_id;

    -- Reset forecast so the new curve takes effect immediately
    fc := '[]'::jsonb;
    fcur := round((fmin + (random()::numeric) * (fmax - fmin))::numeric, 2);

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
END $function$;

-- Recompute immediately with the new curve
SELECT public.recompute_fish_prices();