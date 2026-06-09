
-- 1) Add stars columns to ships_owned for the upgradeable submarine
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS stars int NOT NULL DEFAULT 1;
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS max_stars int NOT NULL DEFAULT 1;

-- 2) Capacity per star tier (1=350k, 2=500k, 3=700k, 4=850k, 5=red=1M)
CREATE OR REPLACE FUNCTION public.submarine_capacity_for_stars(_stars int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _stars >= 5 THEN 1000000
    WHEN _stars = 4 THEN 850000
    WHEN _stars = 3 THEN 700000
    WHEN _stars = 2 THEN 500000
    ELSE 350000
  END;
$$;
GRANT EXECUTE ON FUNCTION public.submarine_capacity_for_stars(int) TO authenticated, anon;

-- 3) Upgrade RPC
CREATE OR REPLACE FUNCTION public.upgrade_submarine(_ship_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  IF _ship.at_sea THEN RAISE EXCEPTION 'at_sea'; END IF;
  IF _ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'destroyed'; END IF;

  _chance := CASE COALESCE(_ship.stars,1)
    WHEN 1 THEN 100
    WHEN 2 THEN 95
    WHEN 3 THEN 90
    WHEN 4 THEN 70
    ELSE 0
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

  UPDATE ships_owned
    SET stars = _new_stars,
        max_stars = GREATEST(COALESCE(max_stars,1), _new_stars),
        max_hp = _new_cap,
        hp = LEAST(GREATEST(hp,1), _new_cap)
    WHERE id = _ship_id;

  RETURN jsonb_build_object(
    'success', _success,
    'stars', _new_stars,
    'chance', _chance,
    'roll', _roll,
    'capacity', _new_cap,
    'cost', _cost
  );
END $$;
GRANT EXECUTE ON FUNCTION public.upgrade_submarine(uuid) TO authenticated;

-- 4) Fix fish market upgrade cost — raise base from 500 to 50,000
CREATE OR REPLACE FUNCTION public.fish_market_upgrade_cost(_level int)
RETURNS TABLE(cost_coins bigint, seconds int) LANGUAGE sql IMMUTABLE AS $$
  SELECT
    (50000 * power(1.8, GREATEST(_level,1) - 1))::bigint AS cost_coins,
    (30 + GREATEST(_level,1) * 60)::int AS seconds;
$$;

-- 5) New capacity curve: L26 = 500k, peak L30 = 1M
CREATE OR REPLACE FUNCTION public.fish_market_capacity(_level int)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _lvl int := GREATEST(1, LEAST(30, COALESCE(_level, 1))); _cap bigint := 10000; _l int;
BEGIN
  FOR _l IN 2.._lvl LOOP
    IF _l <= 10 THEN _cap := _cap + 10000;       -- L10 = 100k
    ELSIF _l <= 20 THEN _cap := _cap + 20000;    -- L20 = 300k
    ELSIF _l <= 26 THEN _cap := _cap + 33333;    -- L26 ≈ 500k
    ELSE _cap := _cap + 125000; END IF;          -- L30 = 1M
  END LOOP;
  -- Force exact landmarks
  IF _lvl = 26 THEN _cap := 500000; END IF;
  IF _lvl = 30 THEN _cap := 1000000; END IF;
  RETURN _cap;
END $$;

-- 6) Compensation — downgrade users that exploited the 500-gold bug
DO $$
DECLARE _u record; _paid_old bigint; _l int; _expected bigint; _max_l int;
BEGIN
  FOR _u IN SELECT user_id, level FROM public.user_fish_market WHERE level > 1 LOOP
    -- estimate total they paid under OLD curve (500 * 1.6^(l-1)) for levels 1..(level-1)
    _paid_old := 0;
    FOR _l IN 1.._u.level-1 LOOP
      _paid_old := _paid_old + (500 * power(1.6, _l - 1))::bigint;
    END LOOP;
    -- find max level affordable under NEW curve
    _expected := 0;
    _max_l := 1;
    FOR _l IN 1..29 LOOP
      _expected := _expected + (50000 * power(1.8, _l - 1))::bigint;
      EXIT WHEN _expected > _paid_old;
      _max_l := _l + 1;
    END LOOP;
    IF _max_l < _u.level THEN
      UPDATE public.user_fish_market 
         SET level = _max_l, upgrading_to = NULL, upgrade_ends_at = NULL, updated_at = now()
       WHERE user_id = _u.user_id;
    END IF;
  END LOOP;
END $$;
