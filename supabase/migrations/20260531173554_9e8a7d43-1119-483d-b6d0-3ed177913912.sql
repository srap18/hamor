INSERT INTO public.ship_catalog (code, name, active, sort_order)
VALUES ('ship-lvl-31', 'سفينة العنقاء التنينية', true, 31)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true, sort_order = EXCLUDED.sort_order;