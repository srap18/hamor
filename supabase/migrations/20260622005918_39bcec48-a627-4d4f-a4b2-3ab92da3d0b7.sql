ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_item_type_check;

ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_type_check
CHECK (
  item_type = ANY (
    ARRAY[
      'crew'::text,
      'weapon'::text,
      'consumable'::text,
      'decoration'::text,
      'frame'::text,
      'background'::text,
      'name_frame'::text,
      'bubble_frame'::text,
      'profile_frame'::text,
      'shield'::text,
      'anti'::text,
      'anti_rocket'::text,
      'anti_nuke'::text,
      'anti_ad_bomb'::text
    ]
  )
);