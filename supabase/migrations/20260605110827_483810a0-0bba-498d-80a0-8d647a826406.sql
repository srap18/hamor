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
  _cur_gems integer;
  _coins_to_spend bigint;
  _gems_to_spend integer := 0;
  _shortfall bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price_coins < 0 OR _price_coins > 1000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp < 50 OR _max_hp > 100000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  IF _template_id < 1 OR _template_id > 100 THEN RAISE EXCEPTION 'bad template'; END IF;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _template_id > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN
      RAISE EXCEPTION 'fleet and storage full';
    END IF;
    _put_in_storage := true;
  END IF;

  -- Read current wallet to compute gem fallback (1 gem = 1000 coins)
  SELECT coins, gems INTO _cur_coins, _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;

  IF _cur_coins >= _price_coins THEN
    _coins_to_spend := _price_coins;
    _gems_to_spend := 0;
  ELSE
    _coins_to_spend := _cur_coins;
    _shortfall := _price_coins - _cur_coins;
    _gems_to_spend := CEIL(_shortfall::numeric / 1000.0)::int;
    IF _cur_gems < _gems_to_spend THEN
      RAISE EXCEPTION 'insufficient coins and gems';
    END IF;
  END IF;

  PERFORM public._mutate_currency(_uid, -_coins_to_spend, -_gems_to_spend, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp, _put_in_storage)
    RETURNING id INTO _new;
  RETURN _new;
END $function$;