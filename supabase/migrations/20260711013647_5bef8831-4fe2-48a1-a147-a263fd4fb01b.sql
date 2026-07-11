
-- 1) Submarine now catches silver_arowana + coral_phantom (replace abyss_titan)
UPDATE public.ship_catalog SET fish_pool = '["silver_arowana","coral_phantom"]'::jsonb WHERE code = 'submarine';

-- 2) Add abyss_titan as an extra catch for mythic-tier ships (levels 26-30)
UPDATE public.ship_catalog
   SET fish_pool = (
     SELECT jsonb_agg(DISTINCT elem)
       FROM jsonb_array_elements_text(fish_pool || '["abyss_titan"]'::jsonb) elem
   )
 WHERE code IN ('ship-lvl-26','ship-lvl-27','ship-lvl-28','ship-lvl-29','ship-lvl-30');

-- 3) Seed price settings for the two new fish so admin panel can edit them
INSERT INTO public.fish_price_settings (fish_id, min_price, max_price, max_hourly_change)
VALUES
  ('silver_arowana', 20, 60, 2),
  ('coral_phantom',  20, 60, 2)
ON CONFLICT (fish_id) DO NOTHING;

-- 4) Seed live market prices for the two new fish
INSERT INTO public.fish_market_prices (fish_id, min_price, max_price, current_price)
VALUES
  ('silver_arowana', 20, 60, 30),
  ('coral_phantom',  20, 60, 30)
ON CONFLICT (fish_id) DO NOTHING;
