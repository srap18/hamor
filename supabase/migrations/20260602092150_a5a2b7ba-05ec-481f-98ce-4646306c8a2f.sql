UPDATE public.ship_catalog
SET
  market_level_required = 31,
  storage = 13000,
  max_hp = 13000,
  fishing_seconds = 1200,
  fish_pool = '["phoenix"]'::jsonb,
  name = COALESCE(NULLIF(name, ''), 'سفينة العنقاء التنينية'),
  description = COALESCE(NULLIF(description, ''), 'سفينة العنقاء الحمراء — حصرية للمتجر، تصيد عنقاء النار النادرة فقط.')
WHERE code = 'ship-lvl-31';