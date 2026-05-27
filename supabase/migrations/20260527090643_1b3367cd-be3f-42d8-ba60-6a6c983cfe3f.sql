-- Helper: pay an amount in coins, falling back to gems for any shortfall.
-- Conversion rate: 1 gem = 1000 coins (gems are premium / paid currency).
CREATE OR REPLACE FUNCTION public._pay_coins_with_gem_fallback(_uid uuid, _coins_needed bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cur record;
  _shortfall bigint;
  _gems_needed integer;
BEGIN
  IF _coins_needed <= 0 THEN RETURN; END IF;

  SELECT coins, gems INTO _cur FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;

  IF _cur.coins >= _coins_needed THEN
    -- Enough coins, normal path.
    UPDATE public.profiles SET coins = coins - _coins_needed WHERE id = _uid;
    RETURN;
  END IF;

  -- Cover the shortfall with gems at 1 gem = 1000 coins.
  _shortfall := _coins_needed - _cur.coins;
  _gems_needed := CEIL(_shortfall::numeric / 1000.0)::integer;

  IF _cur.gems < _gems_needed THEN
    RAISE EXCEPTION 'insufficient funds: need % coins or % gems', _shortfall, _gems_needed;
  END IF;

  UPDATE public.profiles
    SET coins = 0,
        gems = gems - _gems_needed
    WHERE id = _uid;
END $$;

GRANT EXECUTE ON FUNCTION public._pay_coins_with_gem_fallback(uuid, bigint) TO authenticated;

-- 1) Generic shop purchase with coins (frames, weapons, crew, etc.)
CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _price bigint; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame') THEN _count := 1; END IF;
  _total := _price * _count;
  PERFORM public._pay_coins_with_gem_fallback(_uid, _total);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
  PERFORM public.daughter_apply_purchase_bonus(_total, 0);
END $$;

-- 2) Buy ship by code
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

  PERFORM public._pay_coins_with_gem_fallback(_uid, _price_coins);

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;

-- 3) Start shipyard market upgrade
CREATE OR REPLACE FUNCTION public.market_start_upgrade()
RETURNS TABLE(new_level integer, ends_at timestamp with time zone, cost_coins bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_market_upgrades();
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1) ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 30 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._pay_coins_with_gem_fallback(_uid, _cost);
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1, upgrade_started_at = now(),
        upgrade_ends_at = _end, upgrade_cost_coins = _cost, updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END $$;