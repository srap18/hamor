-- Backfill broken max_hp values for ships whose row was created before per-template HP was set correctly.
UPDATE public.ships_owned
SET max_hp = 13000, hp = 13000
WHERE template_id = 31 AND max_hp = 100;

UPDATE public.ships_owned
SET max_hp = 20000, hp = 20000
WHERE template_id = 14 AND max_hp = 925;
