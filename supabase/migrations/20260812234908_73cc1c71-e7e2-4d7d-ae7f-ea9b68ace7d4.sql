CREATE OR REPLACE FUNCTION public.upgrade_royal_whale(_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cost bigint := 2000000000;
  _stars int;
  _success_pct int;
  _roll int;
  _success boolean;
  _new_stars int;
  _new_cap int;
  _old_cap int;
  _new_hp int;
  _gold bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _ship_id AND user_id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ship_not_found'; END IF;
  IF _ship.catalog_code <> 'royal-whale' THEN RAISE EXCEPTION 'not_royal_whale'; END IF;
  IF _ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'destroyed'; END IF;

  _stars := COALESCE(_ship.stars, 1);
  IF _stars >= 5 THEN RAISE EXCEPTION 'already_max'; END IF;

  _success_pct := CASE _stars
    WHEN 1 THEN 60
    WHEN 2 THEN 50
    WHEN 3 THEN 40
    WHEN 4 THEN 25
    ELSE 0
  END;

  SELECT coins INTO _gold
  FROM public.profiles
  WHERE id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF COALESCE(_gold, 0) < _cost THEN RAISE EXCEPTION 'insufficient_gold'; END IF;

  PERFORM set_config('app.audit_source', 'upgrade_royal_whale', true);
  PERFORM set_config(
    'app.audit_reason',
    format('ترقية الحوت الأرجواني من %s نجمة بنسبة نجاح %s%%', _stars, _success_pct),
    true
  );

  UPDATE public.profiles
  SET coins = coins - _cost
  WHERE id = _uid;

  INSERT INTO public.economy_audit (
    user_id, coins_delta, coins_before, coins_after, source, reason, meta
  ) VALUES (
    _uid, -_cost, _gold, _gold - _cost, 'upgrade_royal_whale',
    'royal_whale_upgrade_cost',
    jsonb_build_object('ship_id', _ship_id, 'from_stars', _stars, 'success_pct', _success_pct)
  );

  _roll := floor(random() * 100)::int;
  _success := _roll < _success_pct;
  _new_stars := CASE
    WHEN _success THEN _stars + 1
    ELSE GREATEST(1, _stars - 1)
  END;

  _new_cap := CASE _new_stars
    WHEN 1 THEN 400000
    WHEN 2 THEN 900000
    WHEN 3 THEN 1500000
    WHEN 4 THEN 2200000
    WHEN 5 THEN 3000000
    ELSE 400000
  END;

  _old_cap := GREATEST(1, COALESCE(_ship.max_hp, CASE _stars
    WHEN 1 THEN 400000 WHEN 2 THEN 900000 WHEN 3 THEN 1500000
    WHEN 4 THEN 2200000 WHEN 5 THEN 3000000 ELSE 400000 END));

  _new_hp := LEAST(
    _new_cap,
    GREATEST(0, ROUND(COALESCE(_ship.hp, _old_cap)::numeric * _new_cap / _old_cap)::int)
  );

  UPDATE public.ships_owned
  SET stars = _new_stars,
      max_stars = GREATEST(COALESCE(max_stars, 1), _new_stars),
      max_hp = _new_cap,
      hp = _new_hp
  WHERE id = _ship_id;

  RETURN jsonb_build_object(
    'success', _success,
    'stars', _new_stars,
    'capacity', _new_cap,
    'hp', _new_hp,
    'roll', _roll,
    'success_pct', _success_pct
  );
END;
$function$;