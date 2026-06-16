
-- 1) Backfill: anyone currently active in golden fisher gets shield aligned to gf expiry
UPDATE public.profiles
   SET protection_until = GREATEST(COALESCE(protection_until, golden_fisher_until), golden_fisher_until)
 WHERE golden_fisher_until IS NOT NULL
   AND golden_fisher_until > now();

-- 2) Make golden_fisher_tick also keep the shield aligned with golden_fisher_until each tick,
--    so the shield lives as long as golden fisher is active (and only the attack handler removes it).
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
  _elapsed numeric;
  _effective_elapsed numeric;
  _duration int;
  _is_active boolean;
  _luck_mult int;
  _has_sailor boolean;
  _sailor_assigned_at timestamptz;
  _has_guide boolean;
  _preferred text;
  _ship_preferred text;
  _n_cycles int;
  _consumed_cycles int;
  _gf_until timestamptz;
BEGIN
  SELECT golden_fisher_until,
    (
      (golden_fisher_until IS NOT NULL AND golden_fisher_until > _now)
      OR EXISTS (
        SELECT 1 FROM public.inventory i
        WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'golden_fisher'
          AND i.meta ? 'expires_at' AND (i.meta->>'expires_at')::timestamptz > _now
      )
    )
  INTO _gf_until, _is_active
  FROM public.profiles WHERE id = _user;

  IF NOT COALESCE(_is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  -- Keep shield aligned with the golden fisher window. Only attacking clears it (handled in record_attack).
  IF _gf_until IS NOT NULL AND _gf_until > _now THEN
    UPDATE public.profiles
       SET protection_until = GREATEST(COALESCE(protection_until, _gf_until), _gf_until)
     WHERE id = _user;
  END IF;

  -- Finalize any ships whose repair has completed (restores hp + clears flags).
  BEGIN PERFORM public.finalize_ship_repairs(); EXCEPTION WHEN OTHERS THEN NULL; END;

  UPDATE public.ships_owned
     SET fishing_started_at = COALESCE(fishing_started_at, _now),
         at_sea = true
   WHERE user_id = _user
     AND in_storage = false
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL;

  FOR _ship IN
    SELECT s.* FROM public.ships_owned s
    WHERE s.user_id = _user
      AND s.in_storage = false
      AND s.destroyed_at IS NULL
      AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= _now)
      AND s.stealing_target_user_id IS NULL
      AND s.stealing_ends_at IS NULL
      AND s.at_sea = true
      AND s.fishing_started_at IS NOT NULL
  LOOP
    SELECT * INTO _cat FROM public.ship_catalog WHERE id = _ship.ship_id;
    IF _cat.id IS NULL THEN CONTINUE; END IF;

    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len = 0 THEN CONTINUE; END IF;

    _capacity := GREATEST(1, COALESCE(_cat.fish_capacity, 1) + COALESCE(_ship.fish_capacity_bonus, 0));
    _duration := GREATEST(1, COALESCE(_cat.fishing_duration_sec, 60));

    _has_sailor := false; _sailor_assigned_at := NULL;
    SELECT true, COALESCE((i.meta->>'assigned_at')::timestamptz, i.acquired_at)
    INTO _has_sailor, _sailor_assigned_at
    FROM public.inventory i
    WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'sailor'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;

    _elapsed := EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at));
    IF _has_sailor AND _sailor_assigned_at IS NOT NULL AND _sailor_assigned_at > _ship.fishing_started_at THEN
      _effective_elapsed :=
        EXTRACT(EPOCH FROM (_sailor_assigned_at - _ship.fishing_started_at))
        + EXTRACT(EPOCH FROM (_now - _sailor_assigned_at)) * 2;
    ELSIF _has_sailor THEN
      _effective_elapsed := _elapsed * 2;
    ELSE
      _effective_elapsed := _elapsed;
    END IF;

    _n_cycles := FLOOR(_effective_elapsed / _duration)::int;
    IF _n_cycles < 1 THEN CONTINUE; END IF;

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

    _ship_preferred := _ship.preferred_fish_id;
    IF _ship_preferred IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_preferred) THEN
      _chosen := _ship_preferred;
    ELSIF _has_guide AND _preferred IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _preferred) THEN
      _chosen := _preferred;
    ELSE
      _chosen := _pool->>floor(random() * _pool_len)::int;
    END IF;

    _market_remaining := public.user_market_remaining(_user);
    _consumed_cycles := 0;

    IF _market_remaining > 0 THEN
      _qty := LEAST((_capacity::bigint * _luck_mult::bigint * _n_cycles::bigint), _market_remaining);
      _consumed_cycles := LEAST(
        _n_cycles,
        GREATEST(1, CEIL(_qty::numeric / GREATEST(1, (_capacity * _luck_mult)::numeric))::int)
      );

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

        _cycles := _cycles + _consumed_cycles;
      END IF;
    END IF;

    IF _consumed_cycles > 0 THEN
      UPDATE public.ships_owned
         SET fishing_started_at = _now - make_interval(secs => GREATEST(0, FLOOR((_effective_elapsed - (_consumed_cycles * _duration)) / CASE WHEN _has_sailor THEN 2 ELSE 1 END))::int),
             last_fishing_reward_at = _now
       WHERE id = _ship.id;
    END IF;

    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END;
$function$;
