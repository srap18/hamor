-- ============================================================
-- BATCH 1: Economy fixes
--   1. Atomic fish sale (prevents fish reappearing in inventory)
--   2. Daily tribe donation cap (10,000/day per player)
--   3. Atomic 15-day pirate daily-login claim
--   4. Lower fish market prices by 60%
-- ============================================================

-- (1) Atomic sell of caught fish: decrement quantity + credit coins in one transaction.
CREATE OR REPLACE FUNCTION public.sell_fish_caught(_fish_id text, _qty integer, _unit_price numeric)
RETURNS TABLE(remaining integer, coins_earned bigint, new_coins bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _have integer;
  _sell integer;
  _earned bigint;
  _new_coins bigint;
  _remaining integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'invalid qty'; END IF;
  IF _unit_price IS NULL OR _unit_price < 0 THEN RAISE EXCEPTION 'invalid price'; END IF;

  -- Lock the row so concurrent sales can't race
  SELECT quantity INTO _have
  FROM public.fish_caught
  WHERE user_id = _uid AND fish_id = _fish_id
  FOR UPDATE;

  IF _have IS NULL OR _have <= 0 THEN
    RAISE EXCEPTION 'no fish to sell';
  END IF;

  _sell := LEAST(_qty, _have);
  _remaining := _have - _sell;
  _earned := (_sell::numeric * _unit_price)::bigint;

  IF _remaining > 0 THEN
    UPDATE public.fish_caught
      SET quantity = _remaining, updated_at = now()
      WHERE user_id = _uid AND fish_id = _fish_id;
  ELSE
    DELETE FROM public.fish_caught
      WHERE user_id = _uid AND fish_id = _fish_id;
  END IF;

  UPDATE public.profiles
    SET coins = coins + _earned
    WHERE id = _uid
    RETURNING coins INTO _new_coins;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
    VALUES (_uid, 'fish_sale', _earned, 'coins',
            jsonb_build_object('fish_id', _fish_id, 'qty', _sell, 'unit_price', _unit_price));

  remaining := _remaining;
  coins_earned := _earned;
  new_coins := _new_coins;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.sell_fish_caught(text, integer, numeric) TO authenticated;

-- (2) Tribe donation with daily cap of 10,000 per player (UTC day).
CREATE OR REPLACE FUNCTION public.donate_to_tribe(_tribe_id uuid, _amount bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _coins bigint;
  _treasure bigint;
  _cur_level int;
  _need bigint;
  _today_donated bigint;
  _cap bigint := 10000;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount < 100 THEN RAISE EXCEPTION 'min 100 coins'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'not a member';
  END IF;

  -- Daily cap: 10,000 coins per UTC day per player
  SELECT COALESCE(SUM(amount), 0) INTO _today_donated
    FROM public.tribe_donations
    WHERE user_id = _uid
      AND created_at >= ((now() AT TIME ZONE 'UTC')::date)::timestamptz;

  IF _today_donated + _amount > _cap THEN
    RAISE EXCEPTION 'daily cap exceeded: % / %', _today_donated, _cap;
  END IF;

  SELECT coins INTO _coins FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF COALESCE(_coins, 0) < _amount THEN RAISE EXCEPTION 'not enough coins'; END IF;

  UPDATE public.profiles SET coins = coins - _amount WHERE id = _uid;
  UPDATE public.tribes
    SET treasure_coins = treasure_coins + _amount,
        total_donations = total_donations + _amount
    WHERE id = _tribe_id
    RETURNING treasure_coins, level INTO _treasure, _cur_level;

  -- Level-up loop: each level N requires 10000 * N^2 cumulative treasure
  LOOP
    _need := 10000::bigint * _cur_level * _cur_level;
    EXIT WHEN _treasure < _need;
    _treasure := _treasure - _need;
    _cur_level := _cur_level + 1;
  END LOOP;

  UPDATE public.tribes
    SET treasure_coins = _treasure, level = _cur_level
    WHERE id = _tribe_id;

  INSERT INTO public.tribe_donations(tribe_id, user_id, amount)
    VALUES (_tribe_id, _uid, _amount);

  RETURN json_build_object(
    'donated', _amount,
    'today_total', _today_donated + _amount,
    'daily_cap', _cap,
    'tribe_level', _cur_level,
    'tribe_treasure', _treasure
  );
END $$;

GRANT EXECUTE ON FUNCTION public.donate_to_tribe(uuid, bigint) TO authenticated;

-- (3) Atomic 15-day pirate daily-login. Server-side enforcement of one claim per day.
CREATE OR REPLACE FUNCTION public.claim_daily_login_pirate()
RETURNS TABLE(
  day_index integer,
  reward_type text,
  reward_id text,
  reward_qty integer,
  new_streak integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _streak int := 0;
  _last date;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _new_streak int;
  _idx int;
  _r_type text;
  _r_id text;
  _r_qty int;
  _existing int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT current_streak, last_claim_date INTO _streak, _last
    FROM public.daily_login_streaks WHERE user_id = _uid FOR UPDATE;

  IF _last = _today THEN RAISE EXCEPTION 'already claimed today'; END IF;

  IF _last IS NULL OR _last < _today - 1 THEN
    _new_streak := 1;
  ELSE
    _new_streak := _streak + 1;
  END IF;

  -- 15-day cycle: index 0..14
  _idx := ((_new_streak - 1) % 15);

  -- Reward table (must match REWARDS in DailyLoginModal.tsx)
  CASE _idx
    WHEN 0  THEN _r_type := 'coins';  _r_id := 'coins';         _r_qty := 1000;
    WHEN 1  THEN _r_type := 'weapon'; _r_id := 'rocket_small';  _r_qty := 4;
    WHEN 2  THEN _r_type := 'crew';   _r_id := 'sailor';        _r_qty := 1;
    WHEN 3  THEN _r_type := 'weapon'; _r_id := 'rocket_small';  _r_qty := 5;
    WHEN 4  THEN _r_type := 'coins';  _r_id := 'coins';         _r_qty := 3000;
    WHEN 5  THEN _r_type := 'weapon'; _r_id := 'rocket_medium'; _r_qty := 5;
    WHEN 6  THEN _r_type := 'crew';   _r_id := 'fixer_1';       _r_qty := 1;
    WHEN 7  THEN _r_type := 'weapon'; _r_id := 'rocket_medium'; _r_qty := 6;
    WHEN 8  THEN _r_type := 'gems';   _r_id := 'gems';          _r_qty := 20;
    WHEN 9  THEN _r_type := 'weapon'; _r_id := 'rocket_large';  _r_qty := 7;
    WHEN 10 THEN _r_type := 'crew';   _r_id := 'guide';         _r_qty := 1;
    WHEN 11 THEN _r_type := 'weapon'; _r_id := 'rocket_large';  _r_qty := 8;
    WHEN 12 THEN _r_type := 'crew';   _r_id := 'luck';          _r_qty := 1;
    WHEN 13 THEN _r_type := 'coins';  _r_id := 'coins';         _r_qty := 15000;
    WHEN 14 THEN _r_type := 'weapon'; _r_id := 'nuke';          _r_qty := 10;
  END CASE;

  -- Award reward
  IF _r_type = 'coins' THEN
    UPDATE public.profiles SET coins = coins + _r_qty WHERE id = _uid;
  ELSIF _r_type = 'gems' THEN
    UPDATE public.profiles SET gems = gems + _r_qty WHERE id = _uid;
  ELSE
    -- weapon or crew → inventory
    SELECT quantity INTO _existing
      FROM public.inventory
      WHERE user_id = _uid AND item_type = _r_type AND item_id = _r_id
      FOR UPDATE;
    IF _existing IS NULL THEN
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
        VALUES (_uid, _r_type, _r_id, _r_qty);
    ELSE
      UPDATE public.inventory
        SET quantity = quantity + _r_qty
        WHERE user_id = _uid AND item_type = _r_type AND item_id = _r_id;
    END IF;
  END IF;

  -- Persist streak
  INSERT INTO public.daily_login_streaks(user_id, current_streak, last_claim_date, total_claims)
    VALUES (_uid, _new_streak, _today, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET current_streak = _new_streak,
          last_claim_date = _today,
          total_claims = public.daily_login_streaks.total_claims + 1,
          updated_at = now();

  day_index := _idx;
  reward_type := _r_type;
  reward_id := _r_id;
  reward_qty := _r_qty;
  new_streak := _new_streak;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_daily_login_pirate() TO authenticated;

-- (4) Lower fish market prices by 60% (i.e. new = old * 0.4)
UPDATE public.fish_market_prices
  SET current_price = ROUND(current_price * 0.4, 2),
      min_price     = ROUND(min_price     * 0.4, 2),
      max_price     = ROUND(max_price     * 0.4, 2),
      last_updated  = now();