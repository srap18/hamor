
CREATE TABLE IF NOT EXISTS public.fish_price_settings (
  fish_id text PRIMARY KEY,
  min_price numeric(12,4) NOT NULL,
  max_price numeric(12,4) NOT NULL,
  max_hourly_change numeric(12,4) NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fish_price_settings TO anon, authenticated;
GRANT ALL ON public.fish_price_settings TO service_role;

ALTER TABLE public.fish_price_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fps_view_all" ON public.fish_price_settings;
CREATE POLICY "fps_view_all" ON public.fish_price_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "fps_admin_manage" ON public.fish_price_settings;
CREATE POLICY "fps_admin_manage" ON public.fish_price_settings FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    -- Admin overrides
    SELECT min_price, max_price, max_hourly_change
      INTO ovr_min, ovr_max, ovr_hc
      FROM public.fish_price_settings WHERE fish_id = r.fish_id;
    IF ovr_min IS NOT NULL THEN
      fmin := ovr_min;
      fmax := ovr_max;
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
    END IF;
    IF next_cur < fmin THEN next_cur := fmin; END IF;
    IF next_cur > fmax THEN next_cur := fmax; END IF;

    -- Clamp current move vs prev_cur to max_hourly_change
    IF ovr_hc IS NOT NULL AND prev_cur IS NOT NULL THEN
      IF next_cur - prev_cur > ovr_hc THEN next_cur := round((prev_cur + ovr_hc)::numeric, 2); END IF;
      IF prev_cur - next_cur > ovr_hc THEN next_cur := round((prev_cur - ovr_hc)::numeric, 2); END IF;
      IF next_cur < fmin THEN next_cur := fmin; END IF;
      IF next_cur > fmax THEN next_cur := fmax; END IF;
    END IF;

    new_hist := COALESCE(prev_hist, '[]'::jsonb);
    IF prev_cur IS NOT NULL THEN
      new_hist := new_hist || to_jsonb(round(prev_cur, 2));
    END IF;
    IF jsonb_array_length(new_hist) > history_keep THEN
      new_hist := (
        SELECT jsonb_agg(value ORDER BY ord)
        FROM (
          SELECT value, ord
          FROM jsonb_array_elements(new_hist) WITH ORDINALITY t(value, ord)
        ) s
        WHERE ord > jsonb_array_length(new_hist) - history_keep
      );
    END IF;

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
END $function$;
