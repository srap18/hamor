UPDATE public.ship_catalog
   SET fish_pool = '["imperial_moonfish","diamond_manta","royal_amethyst"]'::jsonb,
       description = 'غواصة-حوت أرجوانية ملكية قابلة للترقية بنظام النجوم. تبدأ بسعة 400 ألف وتصل إلى 3 مليون عند النجمة الحمراء. تصيد ثلاثة أنواع فاخرة حصرية: قمرية الإمبراطور 👑، مانتا الألماس 💎، الجمشت الملكي 🔮.'
 WHERE code = 'royal-whale';

INSERT INTO public.fish_ship_max_level(fish_id, max_ship_level, rarity_rank)
VALUES ('imperial_moonfish', 37, 6), ('diamond_manta', 37, 6), ('royal_amethyst', 37, 6)
ON CONFLICT (fish_id) DO NOTHING;

INSERT INTO public.fish_price_settings (fish_id, min_price, max_price, max_hourly_change)
VALUES
  ('imperial_moonfish', 30, 90, 2),
  ('diamond_manta',     32, 96, 2),
  ('royal_amethyst',    34, 100, 2)
ON CONFLICT (fish_id) DO NOTHING;

INSERT INTO public.fish_market_prices (fish_id, min_price, max_price, current_price)
VALUES
  ('imperial_moonfish', 30, 90, 45),
  ('diamond_manta',     32, 96, 48),
  ('royal_amethyst',    34, 100, 50)
ON CONFLICT (fish_id) DO NOTHING;