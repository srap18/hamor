-- 1) Raise validation cap in buy_ship_by_code (HP can now reach 300,000 = ship storage)
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _price_coins < 0 OR _price_coins > 100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp < 50 OR _max_hp > 1000000 THEN RAISE EXCEPTION 'bad hp'; END IF;

  UPDATE public.profiles SET coins = coins - _price_coins
   WHERE user_id = _uid AND coins >= _price_coins;
  IF NOT FOUND THEN RAISE EXCEPTION 'not enough coins'; END IF;

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;

-- 2) Update existing owned ships so max_hp = storage capacity of their catalog level,
--    and refill current hp to the new max so players "feel" the upgrade.
WITH ship_hp(code, new_hp) AS (
  VALUES
    ('ship-lvl-1',     80),     ('ship-lvl-2',     180),
    ('ship-lvl-3',     600),    ('ship-lvl-4',     900),
    ('ship-lvl-5',     1200),   ('ship-lvl-6',     1800),
    ('ship-lvl-7',     2500),   ('ship-lvl-8',     3500),
    ('ship-lvl-9',     5000),   ('ship-lvl-10',    7500),
    ('ship-lvl-11',    9000),   ('ship-lvl-12',    13000),
    ('ship-lvl-13',    16000),  ('ship-lvl-14',    20000),
    ('ship-lvl-15',    25000),  ('ship-lvl-16',    30000),
    ('ship-lvl-17',    36000),  ('ship-lvl-18',    42000),
    ('ship-lvl-19',    50000),  ('ship-lvl-20',    60000),
    ('ship-lvl-21',    72000),  ('ship-lvl-22',    85000),
    ('ship-lvl-23',    100000), ('ship-lvl-24',    120000),
    ('ship-lvl-25',    140000), ('ship-lvl-26',    165000),
    ('ship-lvl-27',    190000), ('ship-lvl-28',    220000),
    ('ship-lvl-29',    260000), ('ship-lvl-30',    300000)
)
UPDATE public.ships_owned so
   SET max_hp = sh.new_hp,
       hp = sh.new_hp
  FROM ship_hp sh
 WHERE so.catalog_code = sh.code;