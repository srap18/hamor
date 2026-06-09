
-- 1) upgrade_submarine: remove at_sea restriction
CREATE OR REPLACE FUNCTION public.upgrade_submarine(_ship_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  RETURN jsonb_build_object('success', _success, 'stars', _new_stars, 'chance', _chance, 'roll', _roll, 'capacity', _new_cap, 'cost', _cost);
END $function$;

-- 2) golden_fisher_tick: accumulate all elapsed cycles
CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _capacity int;
  _market_remaining bigint;
  _qty bigint;
  _unit_value bigint;
  _cycles int := 0;
  _ships_processed int := 0;
  _now timestamptz := now();
  _elapsed int;
  _duration int;
  _is_active boolean;
  _luck_mult int;
  _has_guide boolean;
  _preferred text;
  _n_cycles int;
BEGIN
  SELECT (
    (golden_fisher_until IS NOT NULL AND golden_fisher_until > _now)
    OR EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at' AND (i.meta->>'expires_at')::timestamptz > _now
    )
  ) INTO _is_active FROM public.profiles WHERE id = _user;

  IF NOT COALESCE(_is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  FOR _ship IN
    SELECT * FROM public.ships_owned
    WHERE user_id = _user AND in_storage = false AND destroyed_at IS NULL
      AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
      AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
    FOR UPDATE
  LOOP
    SELECT * INTO _cat FROM public.ship_catalog
    WHERE code = COALESCE(_ship.catalog_code, 'ship-lvl-' || COALESCE(_ship.template_id, 1)) AND active = true
    LIMIT 1;

    IF _cat.id IS NULL THEN
      SELECT * INTO _cat FROM public.ship_catalog
      WHERE sort_order = COALESCE(_ship.template_id, 1) AND active = true
      ORDER BY market_level_required ASC LIMIT 1;
    END IF;

    IF _cat.id IS NULL THEN CONTINUE; END IF;

    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
    IF _pool_len = 0 THEN CONTINUE; END IF;

    IF _ship.fishing_started_at IS NULL THEN
      UPDATE public.ships_owned SET fishing_started_at = _now, at_sea = true WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at))::int);
    _n_cycles := _elapsed / _duration;

    IF _n_cycles < 1 THEN
      UPDATE public.ships_owned SET at_sea = true WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _capacity := GREATEST(1, CASE
      WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
        THEN COALESCE(_ship.max_hp, _cat.storage, 10)
      ELSE COALESCE(_cat.storage, 10)
    END);

    _luck_mult := 1;
    IF EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'luck'
        AND (i.meta->>'assigned_ship_id') = _ship.id::text
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    ) THEN _luck_mult := 2; END IF;

    _has_guide := false; _preferred := NULL;
    SELECT true, (i.meta->>'preferred_fish_id') INTO _has_guide, _preferred
    FROM public.inventory i
    WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'guide'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;

    IF _has_guide AND _preferred IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _preferred) THEN
      _chosen := _preferred;
    ELSE
      _chosen := _pool->>floor(random() * _pool_len)::int;
    END IF;

    _market_remaining := public.user_market_remaining(_user);

    IF _market_remaining > 0 THEN
      _qty := LEAST((_capacity::bigint * _luck_mult::bigint * _n_cycles::bigint), _market_remaining);

      IF _qty > 0 THEN
        INSERT INTO public.fish_caught (user_id, fish_id, quantity, total_caught, updated_at)
        VALUES (_user, _chosen, _qty::int, _qty::int, _now)
        ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
          SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
              total_caught = public.fish_caught.total_caught + EXCLUDED.quantity,
              updated_at = _now;

        SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
        FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen;

        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_user, _chosen, _ship.id, _now, COALESCE(_unit_value, 0), _qty::int);

        INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
        VALUES (_user, _chosen, _now, _qty::int);

        _cycles := _cycles + _n_cycles;
      END IF;
    END IF;

    -- Advance fishing_started_at by completed cycles only (preserve leftover seconds)
    UPDATE public.ships_owned
       SET fishing_started_at = _ship.fishing_started_at + (_n_cycles * _duration) * interval '1 second',
           last_fishing_reward_at = _now,
           at_sea = true
     WHERE id = _ship.id;

    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END;
$function$;
