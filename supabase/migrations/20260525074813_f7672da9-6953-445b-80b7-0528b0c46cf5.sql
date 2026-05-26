ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_item_type_check;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_type_check
  CHECK (item_type = ANY (ARRAY['crew'::text, 'weapon'::text, 'consumable'::text, 'decoration'::text, 'frame'::text]));