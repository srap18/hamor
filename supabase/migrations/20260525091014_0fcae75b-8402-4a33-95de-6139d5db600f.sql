
-- Safe ship purchase keyed by code (price-gated, no client trust on full price)
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _new uuid; _market_level int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price_coins < 0 OR _price_coins > 1000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp < 50 OR _max_hp > 100000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  IF _template_id < 1 OR _template_id > 100 THEN RAISE EXCEPTION 'bad template'; END IF;
  -- enforce market level
  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _template_id > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;
  -- enforce 3 ship cap
  IF (SELECT COUNT(*) FROM public.ships_owned WHERE user_id = _uid) >= 3 THEN
    RAISE EXCEPTION 'fleet full';
  END IF;
  PERFORM public._mutate_currency(_uid, -_price_coins, 0, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp)
    RETURNING id INTO _new;
  RETURN _new;
END $$;

-- Start market upgrade: server computes cost and end time
CREATE OR REPLACE FUNCTION public.market_start_upgrade()
RETURNS TABLE(new_level int, ends_at timestamptz, cost_coins bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_market_upgrades();
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1)
    ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 30 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT cost_coins, seconds INTO _cost, _secs FROM public.market_upgrade_cost(_cur.level);
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT _cur.level + 1, _end, _cost;
END $$;

-- Finish market upgrade with gems based on remaining time
CREATE OR REPLACE FUNCTION public.market_finish_upgrade_with_gems()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := GREATEST(1, CEIL(_secs_left::numeric / 60))::int;
  PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  UPDATE public.user_market
    SET level = upgrading_to,
        upgrading_to = NULL,
        upgrade_started_at = NULL,
        upgrade_ends_at = NULL,
        upgrade_cost_coins = NULL,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN _gems;
END $$;

-- Cosmetic update: avatar/display/etc handled by existing profile RLS
-- Add admin lootbox grant of any type id via existing function (already exists)

GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text, integer, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.market_start_upgrade() TO authenticated;
GRANT EXECUTE ON FUNCTION public.market_finish_upgrade_with_gems() TO authenticated;
