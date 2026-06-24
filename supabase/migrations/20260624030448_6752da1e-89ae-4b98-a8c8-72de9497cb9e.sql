CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _capacity int;
  _market_remaining bigint;
  _qty bigint;
  _unit_value bigint;
  _cycles int := 0;
  _ships_processed int := 0;
  _total_cycles int := 0;
  _now timestamptz := now();
  _elapsed numeric;
  _effective_elapsed numeric;
  _duration int;
  _active_until timestamptz;
  _luck_mult int := 3;
  _has_sailor boolean;
  _sailor_assigned_at timestamptz;
  _has_guide boolean;
  _preferred text;
  _ship_preferred text;
  _n_cycles int;
  _consumed_cycles int;
BEGIN
  SELECT public.golden_fisher_active_until(_user) INTO _active_until;

  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = GREATEST(COALESCE(golden_fisher_until, '-infinity'::timestamptz), _active_until)
   WHERE id = _user;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _user
     AND COALESCE((SELECT protection_until FROM public.profiles WHERE id = _user), '-infinity'::timestamptz) > _now;

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = COALESCE(fishing_started_at, _now)
   WHERE user_id = _user
     AND in_storage = false
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND (at_sea = false OR fishing_started_at IS NULL);

  _market_remaining := public.user_market_remaining(_user);

  FOR _ship IN
    SELECT s.*, c.fishing_seconds, c.fish_pool, c.storage
    FROM public.ships_owned s
    JOIN public.ship_catalog c ON c.code = s.catalog_code
    WHERE s.user_id = _user
      AND s.in_storage = false
      AND s.destroyed_at IS NULL
      AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= _now)
      AND s.stealing_target_user_id IS NULL
      AND s.stealing_ends_at IS NULL
      AND s.at_sea = true
      AND s.fishing_started_at IS NOT NULL
  LOOP
    _duration := GREATEST(60, COALESCE(_ship.fishing_seconds, 600));
    _elapsed := EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at));

    SELECT EXISTS (
      SELECT 1 FROM public.inventory
       WHERE user_id = _user AND item_type='crew' AND item_id='sailor'
         AND (meta->>'assigned_ship_id') = _ship.id::text AND quantity > 0
    ) INTO _has_sailor;

    IF _has_sailor THEN
      SELECT MIN(acquired_at) INTO _sailor_assigned_at
      FROM public.inventory
       WHERE user_id = _user AND item_type='crew' AND item_id='sailor'
         AND (meta->>'assigned_ship_id') = _ship.id::text AND quantity > 0;
      IF _sailor_assigned_at IS NULL THEN _sailor_assigned_at := _now; END IF;
      _effective_elapsed := _elapsed + EXTRACT(EPOCH FROM (_now - GREATEST(_ship.fishing_started_at, _sailor_assigned_at))) * 0.10;
    ELSE
      _effective_elapsed := _elapsed;
    END IF;

    _n_cycles := FLOOR(_effective_elapsed / _duration)::int;
    IF _n_cycles < 1 THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.inventory
       WHERE user_id = _user AND item_type='crew' AND item_id='guide'
         AND (meta->>'assigned_ship_id') = _ship.id::text AND quantity > 0
    ) INTO _has_guide;

    _preferred := NULL;
    IF _has_guide THEN
      SELECT meta->>'preferred_fish_id' INTO _preferred FROM public.inventory
       WHERE user_id = _user AND item_type='crew' AND item_id='guide'
         AND (meta->>'assigned_ship_id') = _ship.id::text
       LIMIT 1;
    END IF;
    _ship_preferred := COALESCE(_preferred, _ship.preferred_fish_id);

    _capacity := GREATEST(0, COALESCE(_ship.storage, 0));
    IF _capacity <= 0 THEN CONTINUE; END IF;

    _consumed_cycles := 0;
    FOR _cycles IN 1.._n_cycles LOOP
      IF _market_remaining <= 0 THEN EXIT; END IF;

      _pool := COALESCE(_ship.fish_pool, '[]'::jsonb);
      _pool_len := jsonb_array_length(_pool);
      IF _pool_len = 0 THEN EXIT; END IF;

      IF _ship_preferred IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(_pool) v WHERE v = _ship_preferred
      ) THEN
        _chosen := _ship_preferred;
      ELSE
        _chosen := _pool->>FLOOR(random() * _pool_len)::int;
      END IF;

      IF _chosen IS NULL THEN CONTINUE; END IF;

      -- Use the live market price (same source as collect_fishing_reward).
      SELECT COALESCE(current_price, 0)::bigint
        INTO _unit_value
        FROM public.fish_market_prices
       WHERE fish_id = _chosen
       LIMIT 1;

      _unit_value := COALESCE(_unit_value, 0);

      IF _unit_value <= 0 THEN
        _qty := _capacity;
      ELSE
        _qty := LEAST(_capacity, FLOOR(_capacity / GREATEST(1, _unit_value))::bigint * _luck_mult);
        IF _qty < 1 THEN _qty := 1; END IF;
      END IF;

      _qty := LEAST(_qty, _market_remaining);
      IF _qty < 1 THEN CONTINUE; END IF;

      INSERT INTO public.fish_stock (user_id, ship_id, fish_id, quantity, caught_at, base_value)
      VALUES (_user, _ship.id, _chosen, _qty, _now, _unit_value);

      _market_remaining := _market_remaining - _qty;
      _consumed_cycles := _consumed_cycles + 1;
    END LOOP;

    IF _consumed_cycles > 0 THEN
      UPDATE public.ships_owned
         SET fishing_started_at = fishing_started_at + (_consumed_cycles * _duration || ' seconds')::interval
       WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      _total_cycles := _total_cycles + _consumed_cycles;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ships', _ships_processed, 'cycles', _total_cycles);
END;
$function$;