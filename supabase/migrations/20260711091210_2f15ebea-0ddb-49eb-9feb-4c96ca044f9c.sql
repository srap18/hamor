CREATE OR REPLACE FUNCTION public.upgrade_submarine(_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cost bigint := 1000000000;
  _stars int;
  _success_pct int;
  _roll int;
  _success boolean;
  _new_stars int;
  _new_cap bigint;
  _gold bigint;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _ship FROM public.ships_owned
   WHERE id = _ship_id AND user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ship_not_found';
  END IF;
  IF _ship.catalog_code <> 'upgrade-sub' THEN
    RAISE EXCEPTION 'not_upgradeable_submarine';
  END IF;

  _stars := COALESCE(_ship.upgrade_stars, 1);
  IF _stars >= 5 THEN
    RAISE EXCEPTION 'already_max';
  END IF;

  _success_pct := CASE _stars
    WHEN 1 THEN 60 WHEN 2 THEN 50 WHEN 3 THEN 40 WHEN 4 THEN 25 ELSE 0
  END;

  SELECT coins INTO _gold FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF COALESCE(_gold,0) < _cost THEN
    RAISE EXCEPTION 'insufficient_gold';
  END IF;

  UPDATE public.profiles SET coins = coins - _cost, updated_at = now() WHERE id = _uid;
  INSERT INTO public.economy_audit(user_id, kind, delta_coins, reason, meta)
  VALUES (_uid, 'submarine_upgrade_cost', -_cost, 'upgrade_submarine', jsonb_build_object('ship_id', _ship_id, 'from_stars', _stars, 'success_pct', _success_pct));

  _roll := floor(random() * 100)::int;
  _success := _roll < _success_pct;

  IF _success THEN
    _new_stars := _stars + 1;
  ELSE
    _new_stars := GREATEST(1, _stars - 1);
  END IF;

  _new_cap := CASE _new_stars
    WHEN 1 THEN 350000 WHEN 2 THEN 500000 WHEN 3 THEN 700000
    WHEN 4 THEN 850000 WHEN 5 THEN 1000000 ELSE 350000
  END;

  UPDATE public.ships_owned
     SET upgrade_stars = _new_stars,
         max_hp = _new_cap,
         updated_at = now()
   WHERE id = _ship_id;

  RETURN jsonb_build_object(
    'success', _success,
    'stars', _new_stars,
    'capacity', _new_cap,
    'roll', _roll,
    'success_pct', _success_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upgrade_submarine(uuid) TO authenticated;