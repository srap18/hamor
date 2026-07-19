-- Deliver missing nukes for mohammed.ku107@gmail.com (3 unfulfilled wp_nuke_mega_50 today = 171 nukes)
SELECT public.grant_inventory_item(
  'e66b23d8-e716-4c16-ab0d-cfa32889c4dc'::uuid,
  'weapon',
  'nuke',
  171
);