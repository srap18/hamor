
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
  _qty int;
  _unit_value bigint;
  _ships_processed int := 0;
  _total_cycles int := 0;
  _ships_launched int := 0;
  _ships_waiting_for_space int := 0;
  _total_fish bigint := 0;
  _now timestamptz := now();
  _elapsed numeric;
  _duration int;
  _active_until timestamptz;
  _luck_mult int;
  _has_luck boolean;
  _has_guide boolean;
  _guide_pref text;
  _ship_preferred text;
  _hp_ratio numeric;
  _market_full boolean := false;
BEGIN
  SELECT public.golden_fisher_active_until(_user) INTO _active_until;
  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _user
     AND COALESCE((SELECT protection_until FROM public.profiles WHERE id = _user), '-infinity'::timestamptz) > _now;

  FOR _ship IN
    SELECT s.*
    FROM public.ships_owned s
    WHERE s.user_id = _user
      AND COALESCE(s.in_storage, false) = false
      AND COALESCE(s.destroyed, false) = false
      AND s.repair_started_at IS NULL
      AND s.being_raided_until IS NULL
    ORDER BY s.created_at
  LOOP
    SELECT * INTO _cat FROM public.ship_catalog WHERE id = _ship.template_id;
    IF _cat IS NULL THEN CONTINUE; END IF;

    _hp_ratio := CASE WHEN COALESCE(_ship.max_hp, 0) > 0 THEN _ship.hp::numeric / _ship.max_hp::numeric ELSE 1 END;
    IF _hp_ratio < 0.30 THEN CONTINUE; END IF;

    _duration := COALESCE(_cat.fishing_duration_seconds, 0);
    IF _duration <= 0 THEN CONTINUE; END IF;

    IF _ship.at_sea AND _ship.fishing_started_at IS NOT NULL THEN
      _elapsed := EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at));
      IF _elapsed < _duration THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.inventory inv
       WHERE inv.user_id = _user
         AND inv.item_type = 'crew'
         AND inv.item_id = 'luck'
         AND inv.quantity > 0
         AND inv.meta->>'assigned_ship_id' = _ship.id::text
         AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
    ) INTO _has_luck;
    _luck_mult := CASE WHEN _has_luck THEN 2 ELSE 1 END;

    _has_guide := false;
    _guide_pref := NULL;
    SELECT true, NULLIF(inv.meta->>'preferred_fish_id','')
      INTO _has_guide, _guide_pref
      FROM public.inventory inv
     WHERE inv.user_id = _user
       AND inv.item_type = 'crew'
       AND inv.item_id = 'guide'
       AND inv.meta->>'assigned_ship_id' = _ship.id::text
       AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
     LIMIT 1;
    _has_guide := COALESCE(_has_guide, false);

    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len <= 0 THEN
      UPDATE public.ships_owned
         SET at_sea = true,
             fishing_started_at = _now,
             last_fishing_reward_at = _now
       WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _ship_preferred := NULL;
    IF _has_guide AND _guide_pref IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref
    ) THEN
      _ship_preferred := _guide_pref;
    ELSIF NULLIF(_ship.preferred_fish_id, '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id
    ) THEN
      _ship_preferred := _ship.preferred_fish_id;
    END IF;

    IF _ship_preferred IS NOT NULL THEN
      _chosen := _ship_preferred;
    ELSE
      SELECT p.value INTO _chosen
        FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
       WHERE p.ord = (1 + (abs(hashtextextended(_ship.id::text || ':' || COALESCE(_ship.fishing_started_at, _now)::text, 71003)) % _pool_len))
       LIMIT 1;
    END IF;

    IF _has_guide AND _guide_pref IS NOT NULL AND _ship.preferred_fish_id IS DISTINCT FROM _guide_pref THEN
      UPDATE public.ships_owned SET preferred_fish_id = _guide_pref WHERE id = _ship.id;
    END IF;

    _capacity := GREATEST(1, CASE
      WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
        THEN COALESCE(_cat.fish_per_trip, 1) * 2
      ELSE COALESCE(_cat.fish_per_trip, 1)
    END) * _luck_mult;

    SELECT COALESCE(price, _cat.fish_base_price, 0) INTO _unit_value
      FROM public.fish_market_prices
     WHERE fish_id = _chosen
     LIMIT 1;
    _unit_value := COALESCE(_unit_value, _cat.fish_base_price, 0);

    _market_remaining := GREATEST(0, COALESCE(_cat.fish_market_cap, 0) - (
      SELECT COALESCE(SUM(quantity), 0)::bigint FROM public.fish_stock WHERE user_id = _user AND ship_id = _ship.id
    ));

    -- FIX: deliver what fits instead of hanging when storage is partially full.
    IF _market_remaining <= 0 THEN
      _market_full := true;
      _ships_waiting_for_space := _ships_waiting_for_space + 1;
      UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _qty := LEAST(_capacity, _market_remaining)::int;

    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_user, _chosen, _qty, _qty)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught;

    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_user, _chosen, _ship.id, _now, _unit_value, _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
    VALUES (_user, _chosen, _now, _qty);

    -- If we just topped off the storage, stop the ship until player frees space.
    IF _qty >= _market_remaining THEN
      _market_full := true;
      _ships_waiting_for_space := _ships_waiting_for_space + 1;
      UPDATE public.ships_owned
         SET at_sea = false,
             fishing_started_at = NULL,
             last_fishing_reward_at = _now
       WHERE id = _ship.id;
    ELSE
      UPDATE public.ships_owned
         SET at_sea = true,
             fishing_started_at = _now,
             last_fishing_reward_at = _now
       WHERE id = _ship.id;
      _ships_launched := _ships_launched + 1;
    END IF;

    _ships_processed := _ships_processed + 1;
    _total_cycles := _total_cycles + 1;
    _total_fish := _total_fish + _qty;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'ships_processed', _ships_processed,
    'launched', _ships_launched,
    'cycles', _total_cycles,
    'fish_added', _total_fish,
    'waiting_for_space', _ships_waiting_for_space,
    'market_full', _market_full
  );
END;
$function$;
