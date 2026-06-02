UPDATE public.ship_catalog
SET fish_pool = '["shark","tuna","grouper","carp","squid","stingray","snapper","eel"]'::jsonb,
    fishing_seconds = 9300,
    storage = 350000
WHERE code = 'ship-lvl-31'
  AND (fish_pool IS NULL OR jsonb_array_length(fish_pool) = 0);