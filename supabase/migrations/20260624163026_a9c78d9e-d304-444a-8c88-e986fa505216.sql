-- Fix orphan catalog_code 'ship-lvl-31' → 'phoenix' on ships_owned.
-- Level 31 ship = Phoenix (catalog code 'phoenix'). Some ships were created
-- with catalog_code='ship-lvl-31' which has no row in ship_catalog, so the
-- golden_fisher_tick JOIN drops them, breaking fishing for the owners
-- (e.g. user 'berlin').
UPDATE public.ships_owned
   SET catalog_code = 'phoenix'
 WHERE catalog_code = 'ship-lvl-31';