insert into public.play_products (sku,title_ar,title_en,description_ar,description_en,price_micros,default_currency,product_type,status,base_plan_id,rewards)
values ('elite_vip_6_monthly','🔱 Elite VIP 6 شهري','Elite VIP 6 Monthly',
 'إمبراطور المحيط — هجوم/دفاع +40%، خصم متجر 35%، 1500 جوهرة يومياً',
 'Ocean Emperor — +40% combat, 35% shop discount, 1500 daily gems',
 400000000,'USD','subs','active','monthly','{"days":30,"eliteTier":6}'::jsonb)
on conflict (sku) do nothing;