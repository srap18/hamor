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
   WHERE id = _uid AND coins >= _price_coins;
  IF NOT FOUND THEN RAISE EXCEPTION 'not enough coins'; END IF;

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;