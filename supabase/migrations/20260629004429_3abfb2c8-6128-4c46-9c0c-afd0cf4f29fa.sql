
-- Fix #1: Golden fisher gives at most ONE cycle worth of fish per tick.
-- This prevents "doubled/tripled fish" when ticks run less often than the ship's fishing duration.
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
  _qty bigint;
  _unit_value bigint;
  _ships_processed int := 0;
  _total_cycles int := 0;
  _ships_launched int := 0;
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
  _market_remaining bigint;
  _cycles int;
  _last_at timestamptz;
  _market_full boolean := false;
  _lock_key bigint;
  _slot_key bigint;
  _ship_locked record;
  _new_last_at timestamptz;
  _inserted_slots int;
  _last_inserted_slot bigint;
  _t_start timestamptz;
  _capacity bigint;
  _attempt int;
  _retry boolean;
  _resolved_code text;
BEGIN
  IF _user IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'missing_user'); END IF;

  _lock_key := hashtextextended('golden_fisher:' || _user::text, 0);
  IF NOT pg_try_advisory_xact_lock(_lock_key) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked');
  END IF;
  SET LOCAL lock_timeout = '800ms';

  SELECT public.golden_fisher_active_until(_user) INTO _active_until;
  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL,
         stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE stealing_target_user_id = _user
      OR (user_id = _user AND stealing_target_user_id IS NOT NULL);

  _market_remaining := public.user_market_remaining(_user);
  IF _market_remaining <= 0 THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL
     WHERE user_id = _user AND COALESCE(in_storage, false) = false
       AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL;
    RETURN jsonb_build_object('ok', true, 'ships_processed', 0, 'launched', 0,
      'cycles', 0, 'fish_added', 0, 'waiting_for_space', 0, 'market_full', true);
  END IF;

  FOR _ship IN
    SELECT s.id FROM public.ships_owned s
     WHERE s.user_id = _user AND COALESCE(s.in_storage, false) = false
       AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL
     ORDER BY s.acquired_at NULLS LAST, s.id
  LOOP
    _attempt := 0; _retry := true;
    WHILE _retry AND _attempt < 3 LOOP
      _attempt := _attempt + 1; _retry := false;
      _t_start := clock_timestamp(); _cycles := 0; _qty := 0;
      BEGIN
        _market_remaining := public.user_market_remaining(_user);
        IF _market_remaining <= 0 THEN _market_full := true; EXIT; END IF;

        SELECT s.* INTO _ship_locked FROM public.ships_owned s WHERE s.id = _ship.id FOR UPDATE OF s;
        IF _ship_locked.id IS NULL THEN EXIT; END IF;
        IF COALESCE(_ship_locked.in_storage, false) THEN EXIT; END IF;
        IF _ship_locked.stealing_target_user_id IS NOT NULL OR _ship_locked.stealing_ends_at IS NOT NULL THEN EXIT; END IF;

        _resolved_code := COALESCE(NULLIF(_ship_locked.catalog_code,''), 'ship-lvl-' || COALESCE(_ship_locked.template_id,1)::text);
        IF NOT EXISTS (SELECT 1 FROM public.ship_catalog c WHERE c.active AND c.code = _resolved_code) THEN
          _resolved_code := CASE COALESCE(_ship_locked.template_id, 0)
            WHEN 31 THEN 'phoenix' WHEN 32 THEN 'submarine' WHEN 33 THEN 'upgrade-sub'
            ELSE _resolved_code END;
          IF EXISTS (SELECT 1 FROM public.ship_catalog c WHERE c.active AND c.code = _resolved_code) THEN
            UPDATE public.ships_owned SET catalog_code = _resolved_code WHERE id = _ship_locked.id;
            _ship_locked.catalog_code := _resolved_code;
          END IF;
        END IF;

        SELECT c.fish_pool, c.fishing_seconds, c.storage, c.fishing_power
          INTO _pool, _duration, _capacity, _qty
          FROM public.ship_catalog c WHERE c.active = true AND c.code = _resolved_code LIMIT 1;

        IF _pool IS NULL THEN
          INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
          VALUES (_user, _ship_locked.id, 0, 0, _market_remaining,
            EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int,
            'no_catalog_for_code:' || COALESCE(_resolved_code,'(null)'));
          UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          EXIT;
        END IF;

        _hp_ratio := CASE WHEN COALESCE(_ship_locked.max_hp,0) > 0
                          THEN COALESCE(_ship_locked.hp,_ship_locked.max_hp)::numeric / _ship_locked.max_hp::numeric
                          ELSE 1 END;
        IF _hp_ratio < 0.30 THEN
          UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship_locked.id;
          EXIT;
        END IF;
        _hp_ratio := GREATEST(0.05, LEAST(1.0, _hp_ratio));

        SELECT public.golden_fisher_active_until(_user) INTO _active_until;
        IF _active_until IS NULL OR _active_until <= _now THEN EXIT; END IF;

        _duration := GREATEST(30, COALESCE(_duration, 600));

        IF NOT COALESCE(_ship_locked.at_sea, false) OR _ship_locked.fishing_started_at IS NULL THEN
          UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _now, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          _ships_launched := _ships_launched + 1;
          EXIT;
        END IF;

        _last_at := GREATEST(COALESCE(_ship_locked.last_fishing_reward_at, _ship_locked.fishing_started_at), _ship_locked.fishing_started_at);
        _elapsed := public._effective_fishing_elapsed(_user, _ship_locked.id, _last_at, _now);
        _cycles := FLOOR(_elapsed / _duration)::int;

        IF _cycles <= 0 THEN
          UPDATE public.ships_owned SET at_sea = true WHERE id = _ship_locked.id;
          EXIT;
        END IF;
        -- HARD CAP: only ONE cycle per tick. Excess elapsed time is discarded so
        -- the player never receives multiple trips worth of fish in a single tick
        -- (prevents "fish doubled/tripled without luck" complaints).
        IF _cycles > 1 THEN _cycles := 1; END IF;

        _new_last_at := _now;

        _inserted_slots := 0; _last_inserted_slot := NULL;
        FOR _slot_key IN FLOOR(EXTRACT(EPOCH FROM _last_at))::bigint + 1
                         .. FLOOR(EXTRACT(EPOCH FROM _last_at))::bigint + _cycles LOOP
          BEGIN
            INSERT INTO public.golden_fisher_rewards(ship_id, reward_slot, user_id, qty)
            VALUES (_ship_locked.id, _slot_key, _user, 0);
            _inserted_slots := _inserted_slots + 1;
            _last_inserted_slot := _slot_key;
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
        END LOOP;

        IF _inserted_slots <= 0 THEN
          UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _new_last_at, last_fishing_reward_at = _new_last_at WHERE id = _ship_locked.id;
          EXIT;
        END IF;

        SELECT EXISTS (SELECT 1 FROM public.inventory inv
           WHERE inv.user_id = _user AND inv.item_type = 'crew' AND inv.item_id = 'luck'
             AND inv.quantity > 0 AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text
             AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
        ) INTO _has_luck;
        _luck_mult := CASE WHEN _has_luck THEN 2 ELSE 1 END;

        _has_guide := false; _guide_pref := NULL;
        SELECT true, NULLIF(inv.meta->>'preferred_fish_id','') INTO _has_guide, _guide_pref
          FROM public.inventory inv
         WHERE inv.user_id = _user AND inv.item_type = 'crew' AND inv.item_id = 'guide'
           AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text
           AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
         LIMIT 1;
        _has_guide := COALESCE(_has_guide, false);

        _pool := COALESCE(_pool, '[]'::jsonb);
        _pool_len := jsonb_array_length(_pool);
        IF _pool_len <= 0 THEN
          INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
          VALUES (_user, _ship_locked.id, _cycles, 0, _market_remaining,
            EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int,
            'empty_fish_pool:' || COALESCE(_resolved_code,'(null)'));
          UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          EXIT;
        END IF;

        _ship_preferred := NULL;
        IF _has_guide AND _guide_pref IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref
        ) THEN _ship_preferred := _guide_pref;
        ELSIF NULLIF(_ship_locked.preferred_fish_id, '') IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_locked.preferred_fish_id
        ) THEN _ship_preferred := _ship_locked.preferred_fish_id;
        END IF;

        IF _ship_preferred IS NOT NULL THEN _chosen := _ship_preferred;
        ELSE
          SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
           WHERE p.ord = (1 + (abs(hashtextextended(_ship_locked.id::text || ':' || _last_at::text, 71003)) % _pool_len)) LIMIT 1;
        END IF;

        IF _has_guide AND _guide_pref IS NOT NULL AND _ship_locked.preferred_fish_id IS DISTINCT FROM _guide_pref THEN
          UPDATE public.ships_owned SET preferred_fish_id = _guide_pref WHERE id = _ship_locked.id;
        END IF;

        _capacity := GREATEST(1, CASE
          WHEN COALESCE(_ship_locked.catalog_code,'') IN ('submarine','upgrade-sub') OR COALESCE(_ship_locked.template_id,0) IN (32,33)
            THEN COALESCE(_ship_locked.max_hp, _capacity, _qty, 1)::bigint
          ELSE COALESCE(_capacity, _qty, 1)::bigint
        END);
        _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::bigint);

        -- Single-cycle reward: capacity × luck multiplier only.
        _qty := _capacity * _luck_mult::bigint;
        _qty := LEAST(_qty, GREATEST(0, _market_remaining));

        IF _qty < 1 THEN
          UPDATE public.ships_owned SET at_sea = true WHERE id = _ship_locked.id;
          _market_full := true; EXIT;
        END IF;

        SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id = _chosen LIMIT 1;
        _unit_value := COALESCE(_unit_value, 0);

        UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _new_last_at, last_fishing_reward_at = _new_last_at WHERE id = _ship_locked.id;

        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
        VALUES (_user, _chosen, _qty::int, _qty::int)
        ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
          SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
              total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
              updated_at = now();

        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_user, _chosen, _ship_locked.id, _now, _unit_value, _qty::int);

        INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
        VALUES (_user, _chosen, _now, _qty::int);

        IF _last_inserted_slot IS NOT NULL THEN
          UPDATE public.golden_fisher_rewards SET qty = _qty, fish_id = _chosen
           WHERE ship_id = _ship_locked.id AND reward_slot = _last_inserted_slot;
        END IF;

        _market_remaining := GREATEST(0, _market_remaining - _qty);
        _ships_processed := _ships_processed + 1;
        _ships_launched := _ships_launched + 1;
        _total_cycles := _total_cycles + _inserted_slots;
        _total_fish := _total_fish + _qty;

        IF _market_remaining <= 0 THEN _market_full := true; EXIT; END IF;

      EXCEPTION
        WHEN deadlock_detected OR lock_not_available THEN
          IF _attempt < 3 THEN _retry := true; PERFORM pg_sleep(0.05 * _attempt);
          ELSE
            INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
            VALUES (_user, _ship.id, _cycles, _qty, _market_remaining,
              EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int, SQLERRM);
          END IF;
        WHEN OTHERS THEN
          INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
          VALUES (_user, _ship.id, _cycles, _qty, _market_remaining,
            EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int, SQLERRM);
      END;
    END LOOP;
    IF _market_full THEN EXIT; END IF;
  END LOOP;

  IF _market_full THEN
    UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL
     WHERE user_id = _user AND COALESCE(in_storage, false) = false
       AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ships_processed', _ships_processed, 'launched', _ships_launched,
    'cycles', _total_cycles, 'fish_added', _total_fish, 'waiting_for_space', 0, 'market_full', _market_full);
END;
$function$;

-- Fix #2: apply_ship_damage must clear destroyed_at/repair_ends_at on any non-fatal
-- hit so finalize_ship_repairs can no longer auto-heal a ship that was previously
-- destroyed but partially repaired. Without this clear, the next finalize tick
-- recomputes hp from elapsed/total and instantly restores the damage we just dealt.
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid; _tpl int; _repair_secs int;
  _resulting_hp int; _resulting_repair timestamptz;
  _prot timestamptz; _attacker uuid := auth.uid();
  _prev_hp int; _lvl int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100) INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_owner) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL, shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _tpl := COALESCE(_tpl, 1);
  _lvl := LEAST(30, GREATEST(1, _tpl));
  _repair_secs := ROUND(60 + (_lvl - 1) * (14400 - 60) / 29.0)::int;
  _resulting_hp := GREATEST(0, _prev_hp - GREATEST(0, _damage));
  IF _resulting_hp <= 0 THEN
    _resulting_repair := now() + make_interval(secs => _repair_secs);
    UPDATE public.ships_owned
       SET hp = 0, destroyed_at = now(), repair_ends_at = _resulting_repair,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT 0, true, _resulting_repair;
  ELSE
    -- Clear any stale repair state so finalize_ship_repairs doesn't undo this damage.
    UPDATE public.ships_owned
       SET hp = _resulting_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END;
$function$;
