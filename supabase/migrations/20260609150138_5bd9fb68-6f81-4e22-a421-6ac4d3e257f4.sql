
CREATE OR REPLACE FUNCTION public.upgrade_submarine(_ship_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cost bigint := 1000000000;
  _roll int;
  _chance int;
  _new_stars int;
  _success boolean;
  _new_cap int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM ships_owned WHERE id=_ship_id AND user_id=_uid FOR UPDATE;
  IF _ship IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF COALESCE(_ship.catalog_code,'') <> 'upgrade-sub' THEN RAISE EXCEPTION 'not_upgradeable'; END IF;
  IF COALESCE(_ship.stars,1) >= 5 THEN RAISE EXCEPTION 'max_rank'; END IF;
  IF _ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'destroyed'; END IF;

  _chance := CASE COALESCE(_ship.stars,1)
    WHEN 1 THEN 100 WHEN 2 THEN 95 WHEN 3 THEN 90 WHEN 4 THEN 70 ELSE 0
  END;

  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);

  _roll := (floor(random()*100))::int + 1;
  _success := _roll <= _chance;
  IF _success THEN
    _new_stars := COALESCE(_ship.stars,1) + 1;
  ELSE
    _new_stars := GREATEST(1, COALESCE(_ship.stars,1) - 1);
  END IF;
  _new_cap := public.submarine_capacity_for_stars(_new_stars);

  -- Always refill HP to full capacity after an upgrade attempt.
  UPDATE ships_owned
    SET stars = _new_stars,
        max_stars = GREATEST(COALESCE(max_stars,1), _new_stars),
        max_hp = _new_cap,
        hp = _new_cap
    WHERE id = _ship_id;

  RETURN jsonb_build_object('success', _success, 'stars', _new_stars, 'chance', _chance, 'roll', _roll, 'capacity', _new_cap, 'cost', _cost);
END $function$;
