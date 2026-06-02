
-- Require ship market level >= 6 to donate to tribe, and clean up past donations from ineligible users.

CREATE OR REPLACE FUNCTION public.donate_to_tribe(_tribe_id uuid, _amount bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _coins bigint;
  _treasure bigint;
  _cur_level int;
  _need bigint;
  _today_donated bigint;
  _cap bigint := 10000;
  _market_level int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount < 100 THEN RAISE EXCEPTION 'min 100 coins'; END IF;

  -- Require ship market level >= 6
  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF COALESCE(_market_level, 1) < 6 THEN
    RAISE EXCEPTION 'يجب الوصول إلى مستوى السفن 6 قبل التبرع للقبيلة';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'not a member';
  END IF;

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
END $function$;

-- One-time cleanup: remove donations made by users currently below ship market level 6,
-- and subtract those amounts from the recipient tribes' totals (clamped to 0).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT td.tribe_id, COALESCE(SUM(td.amount), 0) AS removed
    FROM public.tribe_donations td
    LEFT JOIN public.user_market um ON um.user_id = td.user_id
    WHERE COALESCE(um.level, 1) < 6
    GROUP BY td.tribe_id
  LOOP
    UPDATE public.tribes
      SET total_donations = GREATEST(0, total_donations - r.removed),
          treasure_coins  = GREATEST(0, treasure_coins  - r.removed)
      WHERE id = r.tribe_id;
  END LOOP;

  DELETE FROM public.tribe_donations td
   USING public.user_market um
   WHERE um.user_id = td.user_id AND um.level < 6;

  DELETE FROM public.tribe_donations td
   WHERE NOT EXISTS (SELECT 1 FROM public.user_market um WHERE um.user_id = td.user_id);
END $$;
