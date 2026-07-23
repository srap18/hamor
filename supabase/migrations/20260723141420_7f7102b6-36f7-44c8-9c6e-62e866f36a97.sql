
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text, _client_progress integer DEFAULT NULL::integer)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record; _cat record; _pool jsonb; _pool_len integer; _chosen text;
  _capacity integer;
  _market_remaining bigint;
  _duration integer; _elapsed numeric; _ratio numeric;
  _luck_mult integer := 1; _has_crew boolean := false;
  _has_guide boolean := false; _guide_pref text; _owns_guide boolean := false;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _grace_seconds constant numeric := 5;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.max_hp IS NOT NULL AND _ship.max_hp > 0 AND _ship.hp IS NOT NULL THEN
    _hp_ratio := _ship.hp::numeric / _ship.max_hp::numeric;
    IF _hp_ratio < 0.30 THEN
      UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
    _hp_ratio := GREATEST(0.05, LEAST(1.0, _hp_ratio));
  END IF;

  IF _ship.fishing_started_at IS NULL THEN RAISE EXCEPTION 'not_fishing'; END IF;
  IF NOT COALESCE(_ship.at_sea, false) THEN
    UPDATE public.ships_owned so SET at_sea = true WHERE so.id = _ship_id;
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = _ship.catalog_code AND sc.active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND sc.active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.sort_order = COALESCE(_ship.template_id, 1) AND sc.active = true ORDER BY sc.market_level_required ASC LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN RAISE EXCEPTION 'ship_catalog_missing'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _luck_mult := 2; END IF;

  _has_guide := false; _guide_pref := NULL;
  SELECT true, NULLIF(inv.meta->>'preferred_fish_id','')
    INTO _has_guide, _guide_pref
  FROM public.inventory inv
  WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
    AND inv.meta->>'assigned_ship_id' = _ship_id::text
    AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  LIMIT 1;
  _has_guide := COALESCE(_has_guide, false);

  SELECT EXISTS (SELECT 1 FROM public.inventory inv
                  WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
                    AND inv.quantity > 0
                    AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now()))
    INTO _owns_guide;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  -- Only honor preferred_fish_id when the player currently owns an active guide.
  -- Do NOT persist the choice to ships_owned or guide meta — random selection
  -- must resume automatically the moment the guide expires or is unequipped.
  IF _owns_guide AND _requested_fish_id IS NOT NULL AND _requested_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSIF _has_guide AND _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id) THEN
    _chosen := _ship.preferred_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  -- Removed the auto-persist block: preferred_fish_id is no longer written to
  -- ships_owned or guide inventory meta after collection. Any prior stored
  -- value is intentionally preserved so a renewed guide can pick it up again,
  -- but it will only take effect while an active guide is owned.

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

  _market_remaining := public.user_market_remaining(_uid);
  IF _market_remaining <= 0 THEN RAISE EXCEPTION 'market_full'; END IF;

  _elapsed := public._effective_fishing_elapsed(_uid, _ship_id, _ship.fishing_started_at, now()) + _grace_seconds;
  _ratio := LEAST(1, _elapsed / _duration);

  _base := ROUND(_capacity * _ratio)::integer;
  IF _base <= 0 THEN _base := 1; END IF;
  _base := LEAST(_base, _capacity);

  IF _client_progress IS NOT NULL AND _client_progress >= 0 THEN
    _base := LEAST(_base, _client_progress);
    IF _base < 1 THEN _base := 1; END IF;
  END IF;

  _qty := _base * _luck_mult;
  _qty := LEAST(_qty::bigint, _market_remaining)::int;
  IF _qty < 1 THEN _qty := 1; END IF;

  _xp := 0;

  UPDATE public.ships_owned so
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = now()
   WHERE so.id = _ship_id;

  IF _qty > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _chosen, _qty, _qty)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key
    DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
                  total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
                  updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
      FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen LIMIT 1;
    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _chosen, _ship_id, now(), COALESCE(_unit_value, 0), _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, qty, source)
    SELECT _uid, _chosen, _qty, 'catch'
    WHERE EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.active = true
        AND c.metric = 'fish_specific'
        AND c.target_fish_id = _chosen
        AND now() BETWEEN c.starts_at AND c.ends_at
    );
  END IF;

  RETURN QUERY SELECT _chosen, _qty, _base, GREATEST(0, _qty - _base), _xp,
                      FLOOR(LEAST(_elapsed, _duration))::int, _duration;
END
$function$;


CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ship record; _pool jsonb; _pool_len int; _chosen text; _qty bigint; _unit_value bigint;
  _ships_processed int := 0; _total_cycles int := 0; _ships_launched int := 0; _total_fish bigint := 0;
  _now timestamptz := now(); _elapsed numeric; _duration int; _active_until timestamptz;
  _luck_mult int; _has_luck boolean; _has_guide boolean; _guide_pref text; _ship_preferred text;
  _hp_ratio numeric; _market_remaining bigint; _cycles int; _last_at timestamptz; _market_full boolean := false;
  _lock_key bigint; _slot_key bigint; _ship_locked record; _new_last_at timestamptz; _inserted_slots int; _last_inserted_slot bigint;
  _t_start timestamptz; _capacity bigint; _attempt int; _retry boolean; _resolved_code text; _paused boolean;
BEGIN
  IF _user IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'missing_user'); END IF;
  _lock_key := hashtextextended('golden_fisher:' || _user::text, 0);
  IF NOT pg_try_advisory_xact_lock(_lock_key) THEN RETURN jsonb_build_object('ok', false, 'reason', 'locked'); END IF;
  SET LOCAL lock_timeout = '2500ms';

  SELECT public.golden_fisher_active_until(_user), COALESCE(golden_fisher_paused, false) INTO _active_until, _paused FROM public.profiles WHERE id = _user;
  IF _active_until IS NULL OR _active_until <= _now THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_active'); END IF;
  IF COALESCE(_paused, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'paused'); END IF;

  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE (stealing_target_user_id = _user OR (user_id = _user AND stealing_target_user_id IS NOT NULL))
     AND (at_sea IS DISTINCT FROM false
       OR fishing_started_at IS NOT NULL
       OR stealing_target_user_id IS NOT NULL
       OR stealing_target_ship_id IS NOT NULL
       OR stealing_ends_at IS NOT NULL
       OR stealing_started_at IS NOT NULL);

  _market_remaining := public.user_market_remaining(_user);
  IF _market_remaining <= 0 THEN
    UPDATE public.ships_owned SET at_sea = true, fishing_started_at = COALESCE(fishing_started_at, _now), last_fishing_reward_at = COALESCE(last_fishing_reward_at, fishing_started_at, _now)
     WHERE user_id = _user AND COALESCE(in_storage, false) = false AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
       AND (COALESCE(max_hp, 0) <= 0 OR COALESCE(hp, max_hp, 1)::numeric / GREATEST(max_hp, 1)::numeric >= 0.30)
       AND (at_sea IS DISTINCT FROM true OR fishing_started_at IS NULL OR last_fishing_reward_at IS NULL);
    RETURN jsonb_build_object('ok', true, 'ships_processed', 0, 'launched', 0, 'cycles', 0, 'fish_added', 0, 'waiting_for_space', 1, 'market_full', true);
  END IF;

  FOR _ship IN SELECT s.id FROM public.ships_owned s WHERE s.user_id = _user AND COALESCE(s.in_storage, false) = false AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL ORDER BY s.acquired_at NULLS LAST, s.id LOOP
    _attempt := 0; _retry := true;
    WHILE _retry AND _attempt < 3 LOOP
      _attempt := _attempt + 1; _retry := false; _t_start := clock_timestamp(); _cycles := 0; _qty := 0;
      BEGIN
        _market_remaining := public.user_market_remaining(_user);
        IF _market_remaining <= 0 THEN _market_full := true; EXIT; END IF;
        SELECT s.* INTO _ship_locked FROM public.ships_owned s WHERE s.id = _ship.id FOR UPDATE OF s SKIP LOCKED;
        IF _ship_locked.id IS NULL OR COALESCE(_ship_locked.in_storage, false) OR _ship_locked.stealing_target_user_id IS NOT NULL OR _ship_locked.stealing_ends_at IS NOT NULL THEN EXIT; END IF;

        _resolved_code := COALESCE(NULLIF(_ship_locked.catalog_code,''), 'ship-lvl-' || COALESCE(_ship_locked.template_id,1)::text);
        IF NOT EXISTS (SELECT 1 FROM public.ship_catalog c WHERE c.active AND c.code = _resolved_code) THEN
          _resolved_code := CASE COALESCE(_ship_locked.template_id, 0) WHEN 31 THEN 'phoenix' WHEN 32 THEN 'submarine' WHEN 33 THEN 'upgrade-sub' ELSE _resolved_code END;
        END IF;
        SELECT c.fish_pool, c.fishing_seconds, c.storage, c.fishing_power INTO _pool, _duration, _capacity, _qty FROM public.ship_catalog c WHERE c.active = true AND c.code = _resolved_code LIMIT 1;
        IF _pool IS NULL THEN
          IF _ship_locked.at_sea IS DISTINCT FROM false OR _ship_locked.fishing_started_at IS NOT NULL OR _ship_locked.last_fishing_reward_at IS NOT NULL THEN
            UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          END IF;
          EXIT;
        END IF;

        _hp_ratio := CASE WHEN COALESCE(_ship_locked.max_hp,0) > 0 THEN COALESCE(_ship_locked.hp,_ship_locked.max_hp)::numeric / _ship_locked.max_hp::numeric ELSE 1 END;
        IF _hp_ratio < 0.30 THEN
          IF _ship_locked.at_sea IS DISTINCT FROM false OR _ship_locked.fishing_started_at IS NOT NULL THEN
            UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship_locked.id;
          END IF;
          EXIT;
        END IF;
        _hp_ratio := GREATEST(0.05, LEAST(1.0, _hp_ratio));
        _duration := GREATEST(30, COALESCE(_duration, 600));

        IF NOT COALESCE(_ship_locked.at_sea, false) OR _ship_locked.fishing_started_at IS NULL THEN
          UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _now, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          _ships_launched := _ships_launched + 1; EXIT;
        END IF;

        _last_at := GREATEST(COALESCE(_ship_locked.last_fishing_reward_at, _ship_locked.fishing_started_at), _ship_locked.fishing_started_at);
        _elapsed := public._effective_fishing_elapsed(_user, _ship_locked.id, _last_at, _now);
        _cycles := LEAST(1, FLOOR(_elapsed / _duration)::int);
        IF _cycles <= 0 THEN
          IF _ship_locked.at_sea IS DISTINCT FROM true THEN
            UPDATE public.ships_owned SET at_sea = true WHERE id = _ship_locked.id;
          END IF;
          EXIT;
        END IF;
        _new_last_at := _now;

        _inserted_slots := 0; _last_inserted_slot := NULL;
        FOR _slot_key IN FLOOR(EXTRACT(EPOCH FROM _last_at))::bigint + 1 .. FLOOR(EXTRACT(EPOCH FROM _last_at))::bigint + _cycles LOOP
          BEGIN
            INSERT INTO public.golden_fisher_rewards(ship_id, reward_slot, user_id, qty) VALUES (_ship_locked.id, _slot_key, _user, 0);
            _inserted_slots := _inserted_slots + 1; _last_inserted_slot := _slot_key;
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
        END LOOP;
        IF _inserted_slots <= 0 THEN
          IF _ship_locked.at_sea IS DISTINCT FROM true
             OR _ship_locked.fishing_started_at IS DISTINCT FROM _new_last_at
             OR _ship_locked.last_fishing_reward_at IS DISTINCT FROM _new_last_at THEN
            UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _new_last_at, last_fishing_reward_at = _new_last_at WHERE id = _ship_locked.id;
          END IF;
          EXIT;
        END IF;

        SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _user AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.quantity > 0 AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)) INTO _has_luck;
        _luck_mult := CASE WHEN _has_luck THEN 2 ELSE 1 END;

        -- Only consider a guide that is currently owned, non-expired, and
        -- assigned to this specific ship. Ignore stored preferred_fish_id
        -- entirely while no active guide is equipped.
        _has_guide := false; _guide_pref := NULL;
        SELECT true, NULLIF(inv.meta->>'preferred_fish_id','')
          INTO _has_guide, _guide_pref
        FROM public.inventory inv
        WHERE inv.user_id = _user AND inv.item_type = 'crew' AND inv.item_id = 'guide'
          AND inv.quantity > 0
          AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text
          AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
        LIMIT 1;
        _has_guide := COALESCE(_has_guide, false);

        _pool := COALESCE(_pool, '[]'::jsonb); _pool_len := jsonb_array_length(_pool);
        IF _pool_len <= 0 THEN
          IF _ship_locked.at_sea IS DISTINCT FROM false OR _ship_locked.fishing_started_at IS NOT NULL OR _ship_locked.last_fishing_reward_at IS NOT NULL THEN
            UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          END IF;
          EXIT;
        END IF;

        _ship_preferred := NULL;
        IF _has_guide THEN
          IF NULLIF(_ship_locked.preferred_fish_id, '') IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_locked.preferred_fish_id) THEN
            _ship_preferred := _ship_locked.preferred_fish_id;
          ELSIF _guide_pref IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
            _ship_preferred := _guide_pref;
          END IF;
        END IF;

        IF _ship_preferred IS NOT NULL THEN
          _chosen := _ship_preferred;
        ELSE
          SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
          WHERE p.ord = (1 + (abs(hashtextextended(_ship_locked.id::text || ':' || _last_at::text, 71003)) % _pool_len)) LIMIT 1;
        END IF;

        _capacity := GREATEST(1, CASE WHEN COALESCE(_ship_locked.catalog_code,'') IN ('submarine','upgrade-sub') OR COALESCE(_ship_locked.template_id,0) IN (32,33) THEN COALESCE(_ship_locked.max_hp, _capacity, _qty, 1)::bigint ELSE COALESCE(_capacity, _qty, 1)::bigint END);
        _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::bigint);
        _qty := LEAST(_capacity * _luck_mult::bigint, GREATEST(0, _market_remaining));
        IF _qty < 1 THEN
          IF _ship_locked.at_sea IS DISTINCT FROM true THEN
            UPDATE public.ships_owned SET at_sea = true WHERE id = _ship_locked.id;
          END IF;
          _market_full := true; EXIT;
        END IF;
        SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id = _chosen LIMIT 1;
        IF _ship_locked.at_sea IS DISTINCT FROM true
           OR _ship_locked.fishing_started_at IS DISTINCT FROM _new_last_at
           OR _ship_locked.last_fishing_reward_at IS DISTINCT FROM _new_last_at THEN
          UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _new_last_at, last_fishing_reward_at = _new_last_at WHERE id = _ship_locked.id;
        END IF;
        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught) VALUES (_user, _chosen, _qty::int, _qty::int)
        ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity, total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught, updated_at = now();
        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity) VALUES (_user, _chosen, _ship_locked.id, _now, COALESCE(_unit_value,0), _qty::int);
        IF _last_inserted_slot IS NOT NULL THEN UPDATE public.golden_fisher_rewards SET qty = _qty, fish_id = _chosen WHERE ship_id = _ship_locked.id AND reward_slot = _last_inserted_slot; END IF;
        _market_remaining := GREATEST(0, _market_remaining - _qty); _ships_processed := _ships_processed + 1; _ships_launched := _ships_launched + 1; _total_cycles := _total_cycles + _inserted_slots; _total_fish := _total_fish + _qty;
        IF _market_remaining <= 0 THEN _market_full := true; EXIT; END IF;
      EXCEPTION WHEN deadlock_detected OR lock_not_available THEN IF _attempt < 3 THEN _retry := true; PERFORM pg_sleep(0.05 * _attempt); END IF;
        WHEN OTHERS THEN INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error) VALUES (_user, _ship.id, _cycles, _qty, _market_remaining, EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int, SQLERRM);
      END;
    END LOOP;
    IF _market_full THEN EXIT; END IF;
  END LOOP;

  IF _market_full THEN
    UPDATE public.ships_owned SET at_sea = true, fishing_started_at = COALESCE(fishing_started_at, _now), last_fishing_reward_at = COALESCE(last_fishing_reward_at, fishing_started_at, _now)
     WHERE user_id = _user AND COALESCE(in_storage, false) = false AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
       AND (COALESCE(max_hp, 0) <= 0 OR COALESCE(hp, max_hp, 1)::numeric / GREATEST(max_hp, 1)::numeric >= 0.30)
       AND (at_sea IS DISTINCT FROM true OR fishing_started_at IS NULL OR last_fishing_reward_at IS NULL);
  END IF;
  RETURN jsonb_build_object('ok', true, 'ships_processed', _ships_processed, 'launched', _ships_launched, 'cycles', _total_cycles, 'fish_added', _total_fish, 'waiting_for_space', _market_full::int, 'market_full', _market_full);
END;
$function$;
