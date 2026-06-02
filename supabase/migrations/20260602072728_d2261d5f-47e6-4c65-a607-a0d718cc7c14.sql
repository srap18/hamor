CREATE OR REPLACE FUNCTION public.catch_fish(_ship_id uuid, _fish_id text, _base_value bigint, _xp_gain integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cat record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _base_value < 0 OR _base_value > 10000000 THEN RAISE EXCEPTION 'invalid value'; END IF;
  IF _xp_gain < 0 OR _xp_gain > 100000 THEN RAISE EXCEPTION 'invalid xp'; END IF;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _ship_id
  FOR UPDATE;

  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = _ship.catalog_code AND active = true
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND active = true
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL OR NOT (_cat.fish_pool ? _fish_id) THEN
    RAISE EXCEPTION 'fish_not_allowed_for_ship';
  END IF;

  INSERT INTO public.fish_stock(user_id, fish_id, base_value, ship_id)
  VALUES (_uid, _fish_id, GREATEST(1, _base_value), _ship_id);

  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _fish_id, 1, 1)
  ON CONFLICT (user_id, fish_id) DO UPDATE
  SET quantity = public.fish_caught.quantity + 1,
      total_caught = public.fish_caught.total_caught + 1,
      updated_at = now();

  PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp_gain);
END;
$$;

REVOKE ALL ON FUNCTION public.catch_fish(uuid, text, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catch_fish(uuid, text, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catch_fish(uuid, text, bigint, integer) TO service_role;