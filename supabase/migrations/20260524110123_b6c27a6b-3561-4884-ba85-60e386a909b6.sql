
-- ============ 1) USER MARKET (سوق السفن لكل لاعب) ============
CREATE TABLE IF NOT EXISTS public.user_market (
  user_id UUID PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 30),
  upgrading_to INTEGER,
  upgrade_started_at TIMESTAMPTZ,
  upgrade_ends_at TIMESTAMPTZ,
  upgrade_cost_coins BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_market ENABLE ROW LEVEL SECURITY;

CREATE POLICY um_select_self_or_admin ON public.user_market
  FOR SELECT USING (auth.uid() = user_id OR is_admin(auth.uid()) OR true);
CREATE POLICY um_insert_self ON public.user_market
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY um_update_self ON public.user_market
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY um_admin_all ON public.user_market
  FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============ 2) SHIP CATALOG (قائمة السفن العالمية) ============
CREATE TABLE IF NOT EXISTS public.ship_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  market_level_required INTEGER NOT NULL DEFAULT 1,
  rarity TEXT NOT NULL DEFAULT 'common',
  max_hp INTEGER NOT NULL DEFAULT 100,
  armor INTEGER NOT NULL DEFAULT 0,
  speed INTEGER NOT NULL DEFAULT 10,
  storage INTEGER NOT NULL DEFAULT 10,
  fishing_power INTEGER NOT NULL DEFAULT 10,
  attack_power INTEGER NOT NULL DEFAULT 10,
  fish_pool JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_coins BIGINT NOT NULL DEFAULT 0,
  price_gems INTEGER NOT NULL DEFAULT 0,
  repair_seconds INTEGER NOT NULL DEFAULT 300,
  fishing_seconds INTEGER NOT NULL DEFAULT 30,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ship_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY sc_all_view ON public.ship_catalog FOR SELECT USING (true);
CREATE POLICY sc_admin_manage ON public.ship_catalog
  FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============ 3) EXTEND ships_owned (HP / إصلاح / كاتلوج) ============
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS catalog_code TEXT,
  ADD COLUMN IF NOT EXISTS hp INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_hp INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS destroyed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_ends_at TIMESTAMPTZ;

-- ============ 4) FISH STOCK (مخزون فردي بوقت — للتعفّن) ============
CREATE TABLE IF NOT EXISTS public.fish_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  fish_id TEXT NOT NULL,
  ship_id UUID,
  caught_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  base_value BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.fish_stock ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fish_stock_user ON public.fish_stock(user_id);
CREATE INDEX IF NOT EXISTS idx_fish_stock_caught ON public.fish_stock(caught_at);

CREATE POLICY fs_select_own ON public.fish_stock FOR SELECT USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY fs_insert_own ON public.fish_stock FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY fs_update_own ON public.fish_stock FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY fs_delete_own ON public.fish_stock FOR DELETE USING (auth.uid() = user_id);

-- ============ 5) FISH MARKET PRICES (أسعار ديناميكية عالمية) ============
CREATE TABLE IF NOT EXISTS public.fish_market_prices (
  fish_id TEXT PRIMARY KEY,
  current_price BIGINT NOT NULL DEFAULT 0,
  min_price BIGINT NOT NULL DEFAULT 0,
  max_price BIGINT NOT NULL DEFAULT 0,
  trend NUMERIC NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fish_market_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY fmp_all_view ON public.fish_market_prices FOR SELECT USING (true);
CREATE POLICY fmp_admin_manage ON public.fish_market_prices
  FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============ 6) EXTEND attacks (سجل PvP) ============
ALTER TABLE public.attacks
  ADD COLUMN IF NOT EXISTS damage_dealt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attacker_won BOOLEAN,
  ADD COLUMN IF NOT EXISTS loot_coins BIGINT NOT NULL DEFAULT 0;

-- ============ 7) FUNCTION: حساب تكلفة ووقت ترقية السوق ============
CREATE OR REPLACE FUNCTION public.market_upgrade_cost(_level INTEGER)
RETURNS TABLE(cost_coins BIGINT, seconds INTEGER)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    (500 * POWER(1.45, _level))::BIGINT AS cost_coins,
    CASE
      WHEN _level <= 2 THEN 30
      WHEN _level <= 4 THEN 120
      WHEN _level <= 7 THEN 900
      WHEN _level <= 10 THEN 3600
      WHEN _level <= 15 THEN 14400
      WHEN _level <= 20 THEN 43200
      WHEN _level <= 25 THEN 86400
      ELSE 259200
    END AS seconds;
$$;

-- ============ 8) FUNCTION: إنهاء ترقيات منتهية ============
CREATE OR REPLACE FUNCTION public.finalize_market_upgrades()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_market
  SET level = upgrading_to,
      upgrading_to = NULL,
      upgrade_started_at = NULL,
      upgrade_ends_at = NULL,
      updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL
    AND upgrade_ends_at <= now()
    AND upgrading_to IS NOT NULL;
$$;

-- ============ 9) FUNCTION: تهيئة سوق للاعب جديد ============
CREATE OR REPLACE FUNCTION public.handle_new_user_market()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_market (user_id, level) VALUES (NEW.id, 1)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_market ON auth.users;
CREATE TRIGGER on_auth_user_created_market
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_market();

-- تهيئة الموجودين
INSERT INTO public.user_market (user_id, level)
SELECT id, 1 FROM auth.users
ON CONFLICT DO NOTHING;
