CREATE OR REPLACE FUNCTION public.daily_login_reward_for(_idx int)
RETURNS TABLE(reward_type text, reward_id text, reward_qty int)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  CASE _idx
    WHEN 0  THEN reward_type := 'coins';    reward_id := 'coins';         reward_qty := 5000;
    WHEN 1  THEN reward_type := 'weapon';   reward_id := 'rocket_small';  reward_qty := 5;
    WHEN 2  THEN reward_type := 'anti';     reward_id := 'anti_rocket';   reward_qty := 3;
    WHEN 3  THEN reward_type := 'shield';   reward_id := 'shield_1d';     reward_qty := 1;
    WHEN 4  THEN reward_type := 'coins';    reward_id := 'coins';         reward_qty := 25000;
    WHEN 5  THEN reward_type := 'weapon';   reward_id := 'rocket_medium'; reward_qty := 6;
    WHEN 6  THEN reward_type := 'crew';     reward_id := 'fixer_2';       reward_qty := 1;
    WHEN 7  THEN reward_type := 'gems';     reward_id := 'gems';          reward_qty := 25;
    WHEN 8  THEN reward_type := 'anti';     reward_id := 'anti_nuke';     reward_qty := 2;
    WHEN 9  THEN reward_type := 'weapon';   reward_id := 'rocket_large';  reward_qty := 7;
    WHEN 10 THEN reward_type := 'crew';     reward_id := 'market_expert'; reward_qty := 1;
    WHEN 11 THEN reward_type := 'weapon';   reward_id := 'ad_bomb';       reward_qty := 3;
    WHEN 12 THEN reward_type := 'shield';   reward_id := 'shield_2d';     reward_qty := 1;
    WHEN 13 THEN reward_type := 'coins';    reward_id := 'coins';         reward_qty := 150000;
    WHEN 14 THEN reward_type := 'weapon';   reward_id := 'nuke';          reward_qty := 12;
    ELSE RAISE EXCEPTION 'bad day index %', _idx;
  END CASE;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.claim_daily_login_pirate()
RETURNS TABLE(day_index int, reward_type text, reward_id text, reward_qty int, new_streak int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _streak int := 0;
  _last date;
  _today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  _new_streak int;
  _idx int;
  _r_type text;
  _r_id text;
  _r_qty int;
  _existing int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text, 51001));

  SELECT current_streak, last_claim_date INTO _streak, _last
    FROM public.daily_login_streaks WHERE user_id = _uid FOR UPDATE;

  IF _last = _today THEN RAISE EXCEPTION 'already claimed today'; END IF;

  IF _last IS NULL OR _last < _today - 2 THEN
    _new_streak := 1;
  ELSE
    _new_streak := COALESCE(_streak, 0) + 1;
  END IF;

  _idx := ((_new_streak - 1) % 15);

  SELECT r.reward_type, r.reward_id, r.reward_qty
    INTO _r_type, _r_id, _r_qty
    FROM public.daily_login_reward_for(_idx) r;

  IF _r_type = 'coins' THEN
    UPDATE public.profiles SET coins = coins + _r_qty WHERE id = _uid;
  ELSIF _r_type = 'gems' THEN
    UPDATE public.profiles SET gems = gems + _r_qty WHERE id = _uid;
  ELSE
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

-- Temporary self-test: applies each of the 15 rewards to a user, verifies the
-- balance/inventory actually changed, then reverts every change (net zero).
CREATE OR REPLACE FUNCTION public._selftest_daily_rewards(_uid uuid)
RETURNS TABLE(day int, r_type text, r_id text, qty int, before_v bigint, after_v bigint, ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i int; _t text; _id text; _q int; _b bigint; _a bigint;
BEGIN
  FOR i IN 0..14 LOOP
    SELECT r.reward_type, r.reward_id, r.reward_qty INTO _t, _id, _q
      FROM public.daily_login_reward_for(i) r;

    IF _t = 'coins' THEN
      SELECT coins INTO _b FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET coins = coins + _q WHERE id = _uid;
      SELECT coins INTO _a FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET coins = coins - _q WHERE id = _uid;
    ELSIF _t = 'gems' THEN
      SELECT gems INTO _b FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET gems = gems + _q WHERE id = _uid;
      SELECT gems INTO _a FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET gems = gems - _q WHERE id = _uid;
    ELSE
      SELECT COALESCE(quantity,0) INTO _b FROM public.inventory
        WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      _b := COALESCE(_b, 0);
      INSERT INTO public.inventory(user_id,item_type,item_id,quantity)
        VALUES (_uid,_t,_id,_q)
        ON CONFLICT (user_id,item_type,item_id) DO UPDATE SET quantity = public.inventory.quantity + _q;
      SELECT quantity INTO _a FROM public.inventory
        WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      UPDATE public.inventory SET quantity = quantity - _q
        WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      DELETE FROM public.inventory WHERE user_id=_uid AND item_type=_t AND item_id=_id AND quantity <= 0;
    END IF;

    day := i + 1; r_type := _t; r_id := _id; qty := _q;
    before_v := _b; after_v := _a; ok := (_a - _b = _q);
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._selftest_daily_rewards(uuid) FROM PUBLIC, anon, authenticated;