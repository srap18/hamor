
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _new uuid; _market_level int;
  _active_count int; _storage_count int; _put_in_storage boolean := false;
  _cur_coins bigint; _cur_gems integer; _coins_to_spend bigint;
  _gems_to_spend integer := 0; _shortfall bigint; _cat record;
  _required_level int; _stored_template int; _stored_hp int;
  _server_price bigint; _server_hp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _code AND active = true LIMIT 1;
  IF _cat.code IS NULL THEN RAISE EXCEPTION 'unknown ship code'; END IF;

  -- Server-side authoritative values: IGNORE client _price_coins and _max_hp
  _server_price := COALESCE(_cat.price_coins, 0);
  IF _server_price <= 0 THEN RAISE EXCEPTION 'ship not purchasable with coins'; END IF;

  _required_level := COALESCE(_cat.market_level_required, 1);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _server_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN COALESCE(_cat.max_hp, 100)
    ELSE COALESCE(_cat.max_hp, 100) END;
  _stored_hp := _server_hp;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_level > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN RAISE EXCEPTION 'fleet and storage full'; END IF;
    _put_in_storage := true;
  END IF;

  _server_price := CEIL(public.get_effective_shop_price(_uid, _server_price::numeric))::bigint;

  SELECT coins, gems INTO _cur_coins, _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;

  IF _cur_coins >= _server_price THEN
    _coins_to_spend := _server_price;
    _gems_to_spend := 0;
  ELSE
    _coins_to_spend := _cur_coins;
    _shortfall := _server_price - _cur_coins;
    _gems_to_spend := CEIL(_shortfall::numeric / 1000.0)::int;
    IF _cur_gems < _gems_to_spend THEN RAISE EXCEPTION 'insufficient coins and gems'; END IF;
  END IF;

  PERFORM public._mutate_currency(_uid, -_coins_to_spend, -_gems_to_spend, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
    VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, 1)
    RETURNING id INTO _new;
  RETURN _new;
END $function$;
