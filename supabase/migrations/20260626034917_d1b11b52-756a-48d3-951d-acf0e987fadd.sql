
-- 1) Dedup table: prevents granting the same fishing cycle twice for the same ship
CREATE TABLE IF NOT EXISTS public.golden_fisher_rewards (
  ship_id uuid NOT NULL,
  reward_slot bigint NOT NULL,
  user_id uuid NOT NULL,
  fish_id text,
  qty bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ship_id, reward_slot)
);
CREATE INDEX IF NOT EXISTS golden_fisher_rewards_user_idx
  ON public.golden_fisher_rewards (user_id, created_at DESC);

GRANT SELECT ON public.golden_fisher_rewards TO authenticated;
GRANT ALL ON public.golden_fisher_rewards TO service_role;
ALTER TABLE public.golden_fisher_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner reads own gf rewards" ON public.golden_fisher_rewards;
CREATE POLICY "owner reads own gf rewards"
  ON public.golden_fisher_rewards FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- 2) Error log table
CREATE TABLE IF NOT EXISTS public.golden_fisher_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  ship_id uuid,
  cycles int,
  fish_added bigint,
  remaining_storage bigint,
  exec_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS golden_fisher_errors_recent_idx
  ON public.golden_fisher_errors (created_at DESC);

GRANT ALL ON public.golden_fisher_errors TO service_role;
ALTER TABLE public.golden_fisher_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read gf errors" ON public.golden_fisher_errors;
CREATE POLICY "admins read gf errors"
  ON public.golden_fisher_errors FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3) Hardened tick function
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
  _slot_base bigint;
  _slot_key bigint;
  _ship_locked record;
  _new_last_at timestamptz;
  _inserted_slots int;
  _t_start timestamptz;
BEGIN
  IF _user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user');
  END IF;

  -- (1) Per-user concurrency lock — only one tick per user at a time
  _lock_key := hashtextextended('golden_fisher:' || _user::text, 0);
  IF NOT pg_try_advisory_xact_lock(_lock_key) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked');
  END IF;

  SELECT public.golden_fisher_active_until(_user) INTO _active_until;
  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  -- Cancel any active steal involving this user
  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _user
      OR (user_id = _user AND stealing_target_user_id IS NOT NULL);

  _market_remaining := public.user_market_remaining(_user);

  FOR _ship IN
    SELECT s.id
      FROM public.ships_owned s
     WHERE s.user_id = _user
       AND COALESCE(s.in_storage, false) = false
       AND s.destroyed_at IS NULL
       AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= _now)
       AND s.stealing_target_user_id IS NULL
       AND s.stealing_ends_at IS NULL
     ORDER BY s.acquired_at NULLS LAST, s.id
  LOOP
    _t_start := clock_timestamp();

    BEGIN
      -- (2) Re-fetch market remaining each iteration & exit if full
      _market_remaining := public.user_market_remaining(_user);
      IF _market_remaining <= 0 THEN
        _market_full := true;
        EXIT;
      END IF;

      -- (3) Lock the ship row & re-verify eligibility under the lock
      SELECT s.*, c.fish_pool, c.fishing_seconds, c.storage, c.fishing_power
        INTO _ship_locked
        FROM public.ships_owned s
        JOIN public.ship_catalog c ON c.code = s.catalog_code
       WHERE s.id = _ship.id
       FOR UPDATE OF s;

      IF _ship_locked.id IS NULL THEN CONTINUE; END IF;
      IF COALESCE(_ship_locked.in_storage, false) THEN CONTINUE; END IF;
      IF _ship_locked.destroyed_at IS NOT NULL THEN CONTINUE; END IF;
      IF _ship_locked.repair_ends_at IS NOT NULL AND _ship_locked.repair_ends_at > _now THEN CONTINUE; END IF;
      IF _ship_locked.stealing_target_user_id IS NOT NULL OR _ship_locked.stealing_ends_at IS NOT NULL THEN CONTINUE; END IF;

      _hp_ratio := CASE WHEN COALESCE(_ship_locked.max_hp,0) > 0
                        THEN COALESCE(_ship_locked.hp,_ship_locked.max_hp)::numeric / _ship_locked.max_hp::numeric
                        ELSE 1 END;
      IF _hp_ratio < 0.30 THEN CONTINUE; END IF;

      -- Re-check golden fisher still active mid-loop
      IF public.golden_fisher_active_until(_user) IS NULL
         OR public.golden_fisher_active_until(_user) <= _now THEN
        EXIT;
      END IF;

      _duration := GREATEST(30, COALESCE(_ship_locked.fishing_seconds, 600));
      _last_at := COALESCE(_ship_locked.last_fishing_reward_at,
                           _ship_locked.fishing_started_at,
                           _now - (_duration || ' seconds')::interval);
      _elapsed := EXTRACT(EPOCH FROM (_now - _last_at));
      _cycles := GREATEST(1, FLOOR(_elapsed / _duration)::int);
      IF _cycles > 1000 THEN _cycles := 1000; END IF;

      -- (4) Compute new last_fishing_reward_at based on actual cycles consumed,
      --     NOT wall-clock now(), so overlapping ticks can't double-grant.
      _new_last_at := _last_at + (_cycles * _duration || ' seconds')::interval;
      IF _new_last_at > _now THEN _new_last_at := _now; END IF;

      -- (5) Dedup via per-cycle slots — try to insert one row per granted cycle.
      _slot_base := FLOOR(EXTRACT(EPOCH FROM _last_at) / _duration)::bigint;

      _inserted_slots := 0;
      FOR _slot_key IN _slot_base + 1 .. _slot_base + _cycles LOOP
        BEGIN
          INSERT INTO public.golden_fisher_rewards(ship_id, reward_slot, user_id, qty)
          VALUES (_ship_locked.id, _slot_key, _user, 0);
          _inserted_slots := _inserted_slots + 1;
        EXCEPTION WHEN unique_violation THEN
          -- Already granted this slot — skip silently
          NULL;
        END;
      END LOOP;

      IF _inserted_slots <= 0 THEN
        -- All cycles already paid; just resume fishing
        UPDATE public.ships_owned
           SET at_sea = true,
               fishing_started_at = _now,
               last_fishing_reward_at = _new_last_at
         WHERE id = _ship_locked.id;
        CONTINUE;
      END IF;

      _cycles := _inserted_slots;

      -- Crew bonuses
      SELECT EXISTS (
        SELECT 1 FROM public.inventory inv
         WHERE inv.user_id = _user
           AND inv.item_type = 'crew'
           AND inv.item_id = 'luck'
           AND inv.quantity > 0
           AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text
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
         AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text
         AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
       LIMIT 1;
      _has_guide := COALESCE(_has_guide, false);

      _pool := COALESCE(_ship_locked.fish_pool, '[]'::jsonb);
      _pool_len := jsonb_array_length(_pool);
      IF _pool_len <= 0 THEN
        UPDATE public.ships_owned
           SET at_sea = true,
               fishing_started_at = _now,
               last_fishing_reward_at = _new_last_at
         WHERE id = _ship_locked.id;
        _ships_processed := _ships_processed + 1;
        _ships_launched := _ships_launched + 1;
        CONTINUE;
      END IF;

      _ship_preferred := NULL;
      IF _has_guide AND _guide_pref IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref
      ) THEN
        _ship_preferred := _guide_pref;
      ELSIF NULLIF(_ship_locked.preferred_fish_id, '') IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_locked.preferred_fish_id
      ) THEN
        _ship_preferred := _ship_locked.preferred_fish_id;
      END IF;

      IF _ship_preferred IS NOT NULL THEN
        _chosen := _ship_preferred;
      ELSE
        SELECT p.value INTO _chosen
          FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
         WHERE p.ord = (1 + (abs(hashtextextended(_ship_locked.id::text || ':' || COALESCE(_ship_locked.fishing_started_at, _now)::text, 71003)) % _pool_len))
         LIMIT 1;
      END IF;

      IF _has_guide AND _guide_pref IS NOT NULL
         AND _ship_locked.preferred_fish_id IS DISTINCT FROM _guide_pref THEN
        UPDATE public.ships_owned SET preferred_fish_id = _guide_pref WHERE id = _ship_locked.id;
      END IF;

      _qty := GREATEST(1, COALESCE(_ship_locked.storage, _ship_locked.fishing_power, 1))::bigint
              * _luck_mult::bigint
              * _cycles::bigint;

      -- (6) Hard clamp by remaining capacity and to non-negative
      _qty := LEAST(_qty, GREATEST(0, _market_remaining));

      IF _qty < 1 THEN
        -- Market full mid-loop → just relaunch the ship with new cycle
        UPDATE public.ships_owned
           SET at_sea = true,
               fishing_started_at = _now,
               last_fishing_reward_at = _new_last_at
         WHERE id = _ship_locked.id;
        _market_full := true;
        EXIT;
      END IF;

      SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
        FROM public.fish_market_prices WHERE fish_id = _chosen LIMIT 1;
      _unit_value := COALESCE(_unit_value, 0);

      -- (7) Advance the ship clock FIRST so any concurrent attempt
      --     reads the new last_fishing_reward_at and computes 0 cycles.
      UPDATE public.ships_owned
         SET at_sea = true,
             fishing_started_at = _now,
             last_fishing_reward_at = _new_last_at
       WHERE id = _ship_locked.id;

      -- Then grant the reward
      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
      VALUES (_user, _chosen, _qty::int, _qty::int)
      ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
        SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
            total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_user, _chosen, _ship_locked.id, _now, _unit_value, _qty::int);

      INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
      VALUES (_user, _chosen, _now, _qty::int);

      -- Record the granted qty on the last reward slot (audit)
      UPDATE public.golden_fisher_rewards
         SET qty = _qty, fish_id = _chosen
       WHERE ship_id = _ship_locked.id
         AND reward_slot = _slot_base + _cycles;

      _market_remaining := GREATEST(0, _market_remaining - _qty);
      _ships_processed := _ships_processed + 1;
      _ships_launched := _ships_launched + 1;
      _total_cycles := _total_cycles + _cycles;
      _total_fish := _total_fish + _qty;

      IF _market_remaining <= 0 THEN
        _market_full := true;
        EXIT;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- (8) Per-ship error isolation + log
      INSERT INTO public.golden_fisher_errors(
        user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error
      ) VALUES (
        _user, _ship.id, _cycles, _qty, _market_remaining,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int,
        SQLERRM
      );
      -- Continue with next ship
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'ships_processed', _ships_processed,
    'launched', _ships_launched,
    'cycles', _total_cycles,
    'fish_added', _total_fish,
    'waiting_for_space', 0,
    'market_full', _market_full
  );
END;
$function$;
