
-- Expand fish_ship_max_level check to include dragon ships (34-36) and future headroom
ALTER TABLE public.fish_ship_max_level DROP CONSTRAINT IF EXISTS fish_ship_max_level_max_ship_level_check;
ALTER TABLE public.fish_ship_max_level ADD CONSTRAINT fish_ship_max_level_max_ship_level_check CHECK (max_ship_level >= 1 AND max_ship_level <= 40);

-- Dragon ships catalog
INSERT INTO public.ship_catalog
  (code, name, description, market_level_required, rarity, max_hp, armor, speed, storage,
   fishing_power, attack_power, fish_pool, price_coins, price_gems, repair_seconds, fishing_seconds,
   active, sort_order)
VALUES
  ('dragon-t1', 'سفينة التنين الدموي', 'سفينة تنين حمراء أسطورية — دم 20,000 وسعة 20,000 وصيد كل 20 دقيقة. تصيد التنين الأسود الأسطوري.',
   34, 'Legendary', 20000, 120, 100, 20000, 20000, 15000,
   '["black_dragon"]'::jsonb, 0, 0, 14400, 1200, true, 340),
  ('dragon-t2', 'سفينة التنين الفضي', 'سفينة تنين فضية أسطورية — دم 40,000 وسعة 40,000 وصيد كل 30 دقيقة. تصيد التنين الأسود الأسطوري.',
   35, 'Legendary', 40000, 160, 110, 40000, 40000, 25000,
   '["black_dragon"]'::jsonb, 0, 0, 14400, 1800, true, 350),
  ('dragon-t3', 'سفينة التنين الذهبي', 'سفينة تنين ذهبية أسطورية ملكية — دم 60,000 وسعة 60,000 وصيد كل 40 دقيقة. تصيد التنين الأسود الأسطوري.',
   36, 'Mythic', 60000, 220, 120, 60000, 60000, 40000,
   '["black_dragon"]'::jsonb, 0, 0, 14400, 2400, true, 360)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  market_level_required = EXCLUDED.market_level_required, rarity = EXCLUDED.rarity,
  max_hp = EXCLUDED.max_hp, armor = EXCLUDED.armor, speed = EXCLUDED.speed,
  storage = EXCLUDED.storage, fishing_power = EXCLUDED.fishing_power,
  attack_power = EXCLUDED.attack_power, fish_pool = EXCLUDED.fish_pool,
  repair_seconds = EXCLUDED.repair_seconds, fishing_seconds = EXCLUDED.fishing_seconds,
  active = EXCLUDED.active, sort_order = EXCLUDED.sort_order;

-- Black dragon fish — admin-managed price settings
INSERT INTO public.fish_price_settings (fish_id, min_price, max_price, max_hourly_change)
VALUES ('black_dragon', 50, 200, 10)
ON CONFLICT (fish_id) DO NOTHING;

INSERT INTO public.fish_market_prices (fish_id, current_price, min_price, max_price)
VALUES ('black_dragon', 100, 50, 200)
ON CONFLICT (fish_id) DO NOTHING;

INSERT INTO public.fish_ship_max_level (fish_id, max_ship_level, rarity_rank)
VALUES ('black_dragon', 36, 6)
ON CONFLICT (fish_id) DO UPDATE SET
  max_ship_level = EXCLUDED.max_ship_level,
  rarity_rank = EXCLUDED.rarity_rank;
