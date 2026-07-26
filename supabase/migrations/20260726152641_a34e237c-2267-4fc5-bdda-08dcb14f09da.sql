ALTER TABLE public.play_products
  ADD COLUMN IF NOT EXISTS base_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS base_plan_state TEXT,
  ADD COLUMN IF NOT EXISTS subscription_exists BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_sync_source TEXT;

INSERT INTO public.play_products
  (sku, title_ar, title_en, description_ar, description_en, price_micros, default_currency, product_type, status, rewards, base_plan_id)
VALUES
  ('elite_vip_1_monthly','⚓ Elite VIP 1 شهري','Elite VIP 1 Monthly','المرساة البرونزية — هجوم/دفاع +5%، خصم متجر 5%، 50 جوهرة يومياً','Bronze Anchor — +5% combat, 5% shop discount, 50 daily gems',19000000,'USD','subs','active','{"eliteTier":1,"days":30}'::jsonb,'monthly'),
  ('elite_vip_2_monthly','🛡️ Elite VIP 2 شهري','Elite VIP 2 Monthly','الدرع الفضي — هجوم/دفاع +10%، خصم متجر 10%، 120 جوهرة يومياً','Silver Shield — +10% combat, 10% shop discount, 120 daily gems',29000000,'USD','subs','active','{"eliteTier":2,"days":30}'::jsonb,'monthly'),
  ('elite_vip_3_monthly','👑 Elite VIP 3 شهري','Elite VIP 3 Monthly','التاج الذهبي — هجوم/دفاع +15%، خصم متجر 15%، 250 جوهرة يومياً','Golden Crown — +15% combat, 15% shop discount, 250 daily gems',49000000,'USD','subs','active','{"eliteTier":3,"days":30}'::jsonb,'monthly'),
  ('elite_vip_4_monthly','⛵ Elite VIP 4 شهري','Elite VIP 4 Monthly','السفينة الملكية — هجوم/دفاع +20%، خصم متجر 20%، 450 جوهرة يومياً','Royal Ship — +20% combat, 20% shop discount, 450 daily gems',79000000,'USD','subs','active','{"eliteTier":4,"days":30}'::jsonb,'monthly'),
  ('elite_vip_5_monthly','🐉 Elite VIP 5 شهري','Elite VIP 5 Monthly','التنين الأسطوري — هجوم/دفاع +30%، خصم متجر 30%، 800 جوهرة يومياً','Legendary Dragon — +30% combat, 30% shop discount, 800 daily gems',99000000,'USD','subs','active','{"eliteTier":5,"days":30}'::jsonb,'monthly')
ON CONFLICT (sku) DO UPDATE SET
  product_type = EXCLUDED.product_type,
  base_plan_id = COALESCE(public.play_products.base_plan_id, EXCLUDED.base_plan_id),
  status = EXCLUDED.status;

UPDATE public.play_products SET base_plan_id = 'monthly' WHERE product_type = 'subs' AND base_plan_id IS NULL;