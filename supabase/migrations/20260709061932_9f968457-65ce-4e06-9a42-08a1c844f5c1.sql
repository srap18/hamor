
-- 1) Finalize functions now award cashback per successfully-completed upgrade
CREATE OR REPLACE FUNCTION public.finalize_market_upgrades()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT user_id, upgrade_cost_coins
    FROM public.user_market
    WHERE upgrade_ends_at IS NOT NULL
      AND upgrade_ends_at <= now() + interval '10 seconds'
      AND upgrading_to IS NOT NULL
    FOR UPDATE
  LOOP
    UPDATE public.user_market
      SET level = GREATEST(level, upgrading_to),
          upgrading_to = NULL,
          upgrade_started_at = NULL,
          upgrade_ends_at = NULL,
          upgrade_cost_coins = NULL,
          updated_at = now()
      WHERE user_id = r.user_id;
    IF COALESCE(r.upgrade_cost_coins, 0) > 0 THEN
      PERFORM public.award_vip_cashback(r.user_id, r.upgrade_cost_coins, 'market_upgrade');
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_fish_market_upgrades()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT user_id, upgrade_cost_coins
    FROM public.user_fish_market
    WHERE upgrade_ends_at IS NOT NULL
      AND upgrade_ends_at <= now() + interval '10 seconds'
      AND upgrading_to IS NOT NULL
    FOR UPDATE
  LOOP
    UPDATE public.user_fish_market
      SET level = GREATEST(level, upgrading_to),
          upgrading_to = NULL,
          upgrade_started_at = NULL,
          upgrade_ends_at = NULL,
          upgrade_cost_coins = NULL,
          updated_at = now()
      WHERE user_id = r.user_id;
    IF COALESCE(r.upgrade_cost_coins, 0) > 0 THEN
      PERFORM public.award_vip_cashback(r.user_id, r.upgrade_cost_coins, 'fish_market_upgrade');
    END IF;
  END LOOP;
END;
$$;

-- 2) Remove cashback from start (moved to finalize) — keep same signature
CREATE OR REPLACE FUNCTION public.market_start_upgrade()
RETURNS TABLE(new_level int, ends_at timestamptz, cost_coins bigint)
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
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END;
$$;

CREATE OR REPLACE FUNCTION public.fish_market_start_upgrade()
RETURNS TABLE(new_level int, ends_at timestamptz, cost_coins bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_fish_market_upgrades();
  SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_fish_market(user_id, level) VALUES (_uid, 1) ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 30 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.fish_market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_fish_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END;
$$;

-- 3) Ship upgrade (submarine): no cashback anymore
CREATE OR REPLACE FUNCTION public.upgrade_submarine(_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- No VIP cashback for ship upgrades

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
END;
$$;

-- 4) Gem-finish paths also grant cashback (upgrade succeeds via gems)
CREATE OR REPLACE FUNCTION public.market_finish_upgrade_with_gems()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int; _coin_cost bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := CASE WHEN _secs_left <= 10 THEN 0 ELSE GREATEST(1, CEIL(_secs_left::numeric / 60))::int END;
  IF _gems > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  END IF;
  _coin_cost := COALESCE(_cur.upgrade_cost_coins, 0);
  UPDATE public.user_market
    SET level = GREATEST(level, upgrading_to),
        upgrading_to = NULL,
        upgrade_started_at = NULL,
        upgrade_ends_at = NULL,
        upgrade_cost_coins = NULL,
        updated_at = now()
    WHERE user_id = _uid;
  IF _coin_cost > 0 THEN
    PERFORM public.award_vip_cashback(_uid, _coin_cost, 'market_upgrade_gems_finish');
  END IF;
  RETURN _gems;
END;
$$;

CREATE OR REPLACE FUNCTION public.fish_market_finish_upgrade_with_gems()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int; _coin_cost bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := CASE WHEN _secs_left <= 10 THEN 0 ELSE GREATEST(1, CEIL(_secs_left::numeric / 60))::int END;
  IF _gems > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  END IF;
  _coin_cost := COALESCE(_cur.upgrade_cost_coins, 0);
  UPDATE public.user_fish_market
    SET level = GREATEST(level, upgrading_to),
        upgrading_to = NULL,
        upgrade_started_at = NULL,
        upgrade_ends_at = NULL,
        upgrade_cost_coins = NULL,
        updated_at = now()
    WHERE user_id = _uid;
  IF _coin_cost > 0 THEN
    PERFORM public.award_vip_cashback(_uid, _coin_cost, 'fish_market_upgrade_gems_finish');
  END IF;
  RETURN _gems;
END;
$$;

-- 5) Compensation: credit missed cashback for CURRENT market & fish_market levels
DO $$
DECLARE
  r record;
  _pct int;
  _msum bigint;
  _fsum bigint;
  _cashback bigint;
BEGIN
  FOR r IN
    SELECT p.id AS uid, p.elite_vip_level,
           COALESCE(um.level, 1) AS m_level,
           COALESCE(ufm.level, 1) AS fm_level
    FROM public.profiles p
    LEFT JOIN public.user_market um ON um.user_id = p.id
    LEFT JOIN public.user_fish_market ufm ON ufm.user_id = p.id
    WHERE COALESCE(p.elite_vip_level, 0) >= 1
  LOOP
    SELECT COALESCE(cashback_pct, 0) INTO _pct
      FROM public.elite_vip_tier_config WHERE level = r.elite_vip_level;
    IF _pct <= 0 THEN CONTINUE; END IF;

    _msum := 0;
    _fsum := 0;
    IF r.m_level > 1 THEN
      SELECT COALESCE(SUM(muc.cost_coins), 0) INTO _msum
      FROM generate_series(1, r.m_level - 1) AS gs(L),
           LATERAL public.market_upgrade_cost(gs.L) AS muc;
    END IF;
    IF r.fm_level > 1 THEN
      SELECT COALESCE(SUM(fmc.cost_coins), 0) INTO _fsum
      FROM generate_series(1, r.fm_level - 1) AS gs(L),
           LATERAL public.fish_market_upgrade_cost(gs.L) AS fmc;
    END IF;

    _cashback := FLOOR((_msum + _fsum)::numeric * _pct / 100.0)::bigint;
    IF _cashback > 0 THEN
      PERFORM public._mutate_currency(r.uid, _cashback, 0, 0, 0);
      INSERT INTO public.economy_audit(user_id, coins_delta, gems_delta, source, reason, meta)
      VALUES (r.uid, _cashback, 0, 'vip_cashback_backfill', 'compensation_missed_cashback',
              jsonb_build_object('market_level', r.m_level, 'fish_market_level', r.fm_level,
                                 'vip_level', r.elite_vip_level, 'pct', _pct,
                                 'market_sum', _msum, 'fish_market_sum', _fsum));
    END IF;
  END LOOP;
END $$;
