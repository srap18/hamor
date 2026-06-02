-- Fix الغواصة الملكية: storage was 350000, causing fish_stock INSERT of 350k rows and RPC timeout
UPDATE public.ship_catalog
SET storage = 15000,
    fishing_seconds = LEAST(fishing_seconds, 1800)
WHERE code = 'submarine';