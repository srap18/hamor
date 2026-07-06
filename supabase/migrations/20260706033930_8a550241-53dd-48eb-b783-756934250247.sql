
-- Ship purchase: use tiered cashback instead of flat 30%
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new uuid;
  _market_level int;
  _active_count int;
  _storage_count int;
  _put_in_storage boolean := false;
  _cur_coins bigint;
  _cat record;
  _required_level int;
  _stored_template int;
  _stored_hp int;
  _server_price bigint;
  _server_hp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _code AND active = true LIMIT 1;
  IF _cat.code IS NULL THEN RAISE EXCEPTION 'unknown ship code'; END IF;

  _server_price := COALESCE(_cat.price_coins, 0);
  IF _server_price <= 0 THEN RAISE EXCEPTION 'ship not purchasable with coins'; END IF;

  _required_level := COALESCE(_cat.market_level_required, 1);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _server_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN COALESCE(_cat.max_hp, 100)
    ELSE COALESCE(_cat.max_hp, 100)
  END;
  _stored_hp := _server_hp;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_level > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT COUNT(*) FILTER (WHERE NOT in_storage), COUNT(*) FILTER (WHERE in_storage)
    INTO _active_count, _storage_count
    FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN RAISE EXCEPTION 'fleet and storage full'; END IF;
    _put_in_storage := true;
  END IF;

  SELECT coins INTO _cur_coins FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur_coins < _server_price THEN RAISE EXCEPTION 'insufficient coins'; END IF;

  PERFORM public._mutate_currency(_uid, -_server_price, 0, 0, 0);
  PERFORM public.award_vip_cashback(_uid, _server_price, 'ship_purchase');

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
  VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, 1)
  RETURNING id INTO _new;

  RETURN _new;
END;
$function$;

-- Submarine upgrade: add tiered cashback on the 1B gold cost
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
  PERFORM public.award_vip_cashback(_uid, _cost, 'submarine_upgrade');

  _roll := (floor(random()*100))::int + 1;
  _success := _roll <= _chance;
  IF _success THEN
    _new_stars := COALESCE(_ship.stars,1) + 1;
  ELSE
    _new_stars := GREATEST(1, COALESCE(_ship.stars,1) - 1);
  END IF;
  _new_cap := public.submarine_capacity_for_stars(_new_stars);

  UPDATE ships_owned
    SET stars = _new_stars,
        max_stars = GREATEST(COALESCE(max_stars,1), _new_stars),
        max_hp = _new_cap,
        hp = _new_cap
    WHERE id = _ship_id;

  RETURN jsonb_build_object('success', _success, 'stars', _new_stars, 'chance', _chance, 'roll', _roll, 'capacity', _new_cap, 'cost', _cost);
END $function$;
