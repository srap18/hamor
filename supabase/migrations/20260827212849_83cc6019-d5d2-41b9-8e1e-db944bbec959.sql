CREATE OR REPLACE FUNCTION public.claim_daily_login_pirate()
 RETURNS TABLE(day_index integer, reward_type text, reward_id text, reward_qty integer, new_streak integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- One missed day is forgiven (grace), two or more resets the streak.
  IF _last IS NULL OR _last < _today - 2 THEN
    _new_streak := 1;
  ELSE
    _new_streak := COALESCE(_streak, 0) + 1;
  END IF;

  _idx := ((_new_streak - 1) % 15);

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
END $function$;