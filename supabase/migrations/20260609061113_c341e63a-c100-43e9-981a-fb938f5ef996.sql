
-- Raise market level cap from 30 to 31
ALTER TABLE public.user_market DROP CONSTRAINT IF EXISTS user_market_level_check;
ALTER TABLE public.user_market ADD CONSTRAINT user_market_level_check CHECK (level >= 1 AND level <= 31);

-- Extend market_upgrade_cost to support level 30 -> 31
CREATE OR REPLACE FUNCTION public.market_upgrade_cost(_level integer)
 RETURNS TABLE(cost_coins bigint, seconds integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    (CASE _level
      WHEN 1  THEN 400
      WHEN 2  THEN 2500
      WHEN 3  THEN 7500
      WHEN 4  THEN 11000
      WHEN 5  THEN 20000
      WHEN 6  THEN 50000
      WHEN 7  THEN 90000
      WHEN 8  THEN 150000
      WHEN 9  THEN 300000
      WHEN 10 THEN 700000
      WHEN 11 THEN 2200000
      WHEN 12 THEN 5000000
      WHEN 13 THEN 8000000
      WHEN 14 THEN 12000000
      WHEN 15 THEN 18000000
      WHEN 16 THEN 25000000
      WHEN 17 THEN 34000000
      WHEN 18 THEN 45000000
      WHEN 19 THEN 60000000
      WHEN 20 THEN 80000000
      WHEN 21 THEN 110000000
      WHEN 22 THEN 150000000
      WHEN 23 THEN 200000000
      WHEN 24 THEN 300000000
      WHEN 25 THEN 650000000
      WHEN 26 THEN 800000000
      WHEN 27 THEN 1000000000
      WHEN 28 THEN 2000000000
      WHEN 29 THEN 5000000000
      WHEN 30 THEN 15000000000
      ELSE 9000000000
    END * 3 / 2)::BIGINT,
    CASE WHEN _level <= 2 THEN 30 WHEN _level <= 4 THEN 120 WHEN _level <= 7 THEN 900
         WHEN _level <= 10 THEN 3600 WHEN _level <= 15 THEN 14400 WHEN _level <= 20 THEN 43200
         WHEN _level <= 25 THEN 86400 ELSE 259200 END;
$function$;

-- Register new ships in catalog for admin panel (player gifts + codes)
INSERT INTO public.ship_catalog (code, name, sort_order, active)
VALUES
  ('upgrade-sub', 'الغواصة القابلة للترقية', 31, true),
  ('submarine', 'الغواصة الملكية VIP', 32, true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, active = true;

-- Remove the legacy duplicate phoenix entry (ship-lvl-31) since 31 is now upgrade-sub
DELETE FROM public.ship_catalog WHERE code = 'ship-lvl-31';
