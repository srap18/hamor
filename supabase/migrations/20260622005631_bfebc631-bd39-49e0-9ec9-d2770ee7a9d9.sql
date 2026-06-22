ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_item_type_check;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_type_check
CHECK (item_type = ANY (ARRAY['crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield','anti_rocket','anti_nuke','anti_ad_bomb']));