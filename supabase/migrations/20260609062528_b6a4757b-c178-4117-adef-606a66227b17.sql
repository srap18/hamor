UPDATE public.ships_owned
SET
  catalog_code = 'phoenix',
  max_hp = 13000,
  hp = LEAST(GREATEST(COALESCE(hp, 13000), 1), 13000)
WHERE catalog_code = 'ship-lvl-31'
  AND template_id = 31;

UPDATE public.ships_owned
SET
  max_hp = 13000,
  hp = LEAST(GREATEST(COALESCE(hp, 13000), 1), 13000)
WHERE catalog_code = 'phoenix';