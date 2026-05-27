-- Economy settings (key/value config)
CREATE TABLE IF NOT EXISTS public.economy_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.economy_settings TO anon, authenticated;
GRANT ALL ON public.economy_settings TO service_role;
ALTER TABLE public.economy_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS es_all_view ON public.economy_settings;
CREATE POLICY es_all_view ON public.economy_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS es_admin_manage ON public.economy_settings;
CREATE POLICY es_admin_manage ON public.economy_settings FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- Ship overrides per market level
CREATE TABLE IF NOT EXISTS public.ship_overrides (
  level integer PRIMARY KEY CHECK (level BETWEEN 1 AND 30),
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ship_overrides TO anon, authenticated;
GRANT ALL ON public.ship_overrides TO service_role;
ALTER TABLE public.ship_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_all_view ON public.ship_overrides;
CREATE POLICY so_all_view ON public.ship_overrides FOR SELECT USING (true);
DROP POLICY IF EXISTS so_admin_manage ON public.ship_overrides;
CREATE POLICY so_admin_manage ON public.ship_overrides FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- Fish-ship max level mapping
CREATE TABLE IF NOT EXISTS public.fish_ship_max_level (
  fish_id text PRIMARY KEY,
  max_ship_level integer NOT NULL CHECK (max_ship_level BETWEEN 1 AND 30),
  rarity_rank integer NOT NULL DEFAULT 1
);
GRANT SELECT ON public.fish_ship_max_level TO anon, authenticated;
GRANT ALL ON public.fish_ship_max_level TO service_role;
ALTER TABLE public.fish_ship_max_level ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fsml_all_view ON public.fish_ship_max_level;
CREATE POLICY fsml_all_view ON public.fish_ship_max_level FOR SELECT USING (true);
DROP POLICY IF EXISTS fsml_admin_manage ON public.fish_ship_max_level;
CREATE POLICY fsml_admin_manage ON public.fish_ship_max_level FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

INSERT INTO public.fish_ship_max_level (fish_id, max_ship_level, rarity_rank) VALUES
  ('sardine',5,1),('shrimp',6,1),('tuna',30,3),('grouper',30,3),
  ('squid',30,2),('carp',30,3),('eel',30,3),('tang_blue',10,4),
  ('stingray',30,4),('goldfish',16,5),('shark',30,4),('snapper',30,2)
ON CONFLICT (fish_id) DO UPDATE
  SET max_ship_level = EXCLUDED.max_ship_level,
      rarity_rank = EXCLUDED.rarity_rank;

-- Stealing feature columns on ships
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS stealing_ends_at timestamptz;
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS stealing_target_user_id uuid;
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS stealing_target_ship_id uuid;
GRANT UPDATE (stealing_ends_at, stealing_target_user_id, stealing_target_ship_id) ON public.ships_owned TO authenticated;

-- Convert fish_market_prices price columns to numeric
ALTER TABLE public.fish_market_prices
  ALTER COLUMN current_price TYPE numeric(12,4) USING current_price::numeric,
  ALTER COLUMN min_price     TYPE numeric(12,4) USING min_price::numeric,
  ALTER COLUMN max_price     TYPE numeric(12,4) USING max_price::numeric;

CREATE OR REPLACE FUNCTION public.recompute_fish_prices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; base_low numeric; base_high numeric; rarity_mult numeric;
        fmin numeric; fmax numeric; fcur numeric; prev numeric;
BEGIN
  FOR r IN SELECT fish_id, max_ship_level, rarity_rank FROM public.fish_ship_max_level LOOP
    base_high := 1.03 + ((r.max_ship_level - 1)::numeric / 29.0) * (36.0 - 1.03);
    base_low  := base_high * 0.78;
    rarity_mult := 0.85 + (LEAST(GREATEST(r.rarity_rank,1),6) - 1) * (0.30 / 5.0);
    fmin := round(base_low  * rarity_mult, 2);
    fmax := round(base_high * rarity_mult, 2);
    IF fmax > 36 THEN fmax := 36; END IF;
    IF fmin > fmax THEN fmin := fmax; END IF;
    fcur := round(fmin + (random() * (fmax - fmin))::numeric, 2);
    SELECT current_price INTO prev FROM public.fish_market_prices WHERE fish_id = r.fish_id;
    INSERT INTO public.fish_market_prices (fish_id, min_price, max_price, current_price, trend, last_updated)
    VALUES (r.fish_id, fmin, fmax, fcur, 0, now())
    ON CONFLICT (fish_id) DO UPDATE
      SET min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          current_price = EXCLUDED.current_price,
          trend = CASE WHEN prev IS NULL OR prev = 0 THEN 0
                       ELSE round(((EXCLUDED.current_price - prev) / prev) * 100, 2) END,
          last_updated = now();
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.recompute_fish_prices() TO authenticated, service_role, anon;
SELECT public.recompute_fish_prices();

-- Paddle helper RPCs
CREATE OR REPLACE FUNCTION public.shield_purchases_last_week(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::integer FROM public.transactions
  WHERE user_id = _user_id AND kind = 'shield' AND created_at > now() - interval '7 days';
$$;
GRANT EXECUTE ON FUNCTION public.shield_purchases_last_week(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_bought_starter(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.transactions
    WHERE user_id = _user_id AND kind = 'starter_pack');
$$;
GRANT EXECUTE ON FUNCTION public.has_bought_starter(uuid) TO authenticated, service_role;