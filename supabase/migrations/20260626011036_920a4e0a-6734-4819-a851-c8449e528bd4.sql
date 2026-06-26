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
  _full_qty int;
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
  _repair_ratio numeric;
  _market_full boolean := false;
BEGIN
  SELECT public.golden_fisher_active_until(_user) INTO _active_until;
  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  -- Cancel attacks against this player while protected.
  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _user
     AND COALESCE((SELECT protection_until FROM public.profiles WHERE id = _user), '-infinity'::timestamptz) > _now;

  _market_remaining := public.user_market_remaining(_user);
  _market_full := (_market_remaining <= 0);

  -- PASS 1: collect only completed full trips, then relaunch immediately.
  FOR _ship IN
    SELECT s.*
      FROM public.ships_owned s
     WHERE s.user_id = _user
       AND s.in_storage = false
       AND s.stealing_target_user_id IS NULL
       AND s.stealing_ends_at IS NULL
       AND s.at_sea = true
       AND s.fishing_started_at IS NOT NULL
     ORDER BY s.fishing_started_at ASC, s.acquired_at ASC
  LOOP
    SELECT * INTO _cat
      FROM public.ship_catalog sc
     WHERE sc.code = _ship.catalog_code AND sc.active = true
     LIMIT 1;

    IF _cat.id IS NULL THEN
      SELECT * INTO _cat
        FROM public.ship_catalog sc
       WHERE sc.code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND sc.active = true
       LIMIT 1;
    END IF;

    IF _cat.id IS NULL THEN
      SELECT * INTO _cat
        FROM public.ship_catalog sc
       WHERE sc.sort_order = COALESCE(_ship.template_id, 1) AND sc.active = true
       ORDER BY sc.market_level_required ASC
       LIMIT 1;
    END IF;

    IF _cat.id IS NULL THEN
      CONTINUE;
    END IF;

    _hp_ratio := 1;
    IF _ship.max_hp IS NOT NULL AND _ship.max_hp > 0 AND _ship.hp IS NOT NULL THEN
      _hp_ratio := _ship.hp::numeric / _ship.max_hp::numeric;
      IF _hp_ratio < 0.30 THEN
        UPDATE public.ships_owned
           SET at_sea = false, fishing_started_at = NULL
         WHERE id = _ship.id;
        CONTINUE;
      END IF;
      _hp_ratio := GREATEST(0.05, LEAST(1.0, _hp_ratio));
    ELSIF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > _now THEN
      _repair_ratio := public._ship_repair_ratio(_ship.destroyed_at, _ship.repair_ends_at);
      IF _repair_ratio < 0.30 THEN
        UPDATE public.ships_owned
           SET at_sea = false, fishing_started_at = NULL
         WHERE id = _ship.id;
        CONTINUE;
      END IF;
      _hp_ratio := GREATEST(0.05, LEAST(1.0, _repair_ratio));
    END IF;

    _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 600));
    _elapsed := public._effective_fishing_elapsed(_user, _ship.id, _ship.fishing_started_at, _now);

    -- Never cash out early. The golden fisher waits for the ship to be truly full.
    IF _elapsed < _duration THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.inventory inv
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

    -- Match manual collect priority without a client request:
    -- saved ship choice, then guide preference, then deterministic trip fish.
    _ship_preferred := COALESCE(NULLIF(_ship.preferred_fish_id, ''), _guide_pref);
    IF _ship_preferred IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_preferred
    ) THEN
      _chosen := _ship_preferred;
    ELSE
      SELECT p.value INTO _chosen
        FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
       WHERE p.ord = (1 + (abs(hashtextextended(_ship.id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len))
       LIMIT 1;
    END IF;

    IF _has_guide AND _chosen IS NOT NULL AND (_ship.preferred_fish_id IS DISTINCT FROM _chosen) THEN
      UPDATE public.ships_owned
         SET preferred_fish_id = _chosen
       WHERE id = _ship.id;

      UPDATE public.inventory inv
         SET meta = COALESCE(inv.meta, '{}'::jsonb) || jsonb_build_object('preferred_fish_id', _chosen)
       WHERE inv.user_id = _user
         AND inv.item_type = 'crew'
         AND inv.item_id = 'guide'
         AND inv.meta->>'assigned_ship_id' = _ship.id::text;
    END IF;

    _capacity := GREATEST(1, CASE
      WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
        THEN COALESCE(_ship.max_hp, _cat.storage, 10)
      ELSE COALESCE(_cat.storage, 10)
    END);
    _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::int);

    -- Luck doubles exactly once, and only once, just like manual collect.
    _full_qty := GREATEST(1, _capacity * _luck_mult);

    -- No partial loss: if the fish storage cannot fit the full completed haul,
    -- keep the ship ready at sea and do not reset its timer.
    IF _market_remaining < _full_qty THEN
      _market_full := true;
      _ships_waiting_for_space := _ships_waiting_for_space + 1;
      CONTINUE;
    END IF;

    _qty := _full_qty;

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
      FROM public.fish_market_prices
     WHERE fish_id = _chosen
     LIMIT 1;
    _unit_value := COALESCE(_unit_value, 0);

    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_user, _chosen, _qty, _qty)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
       SET quantity = public.fish_caught.quantity + _qty,
           total_caught = public.fish_caught.total_caught + _qty,
           updated_at = _now;

    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_user, _chosen, _ship.id, _now, _unit_value, _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
    VALUES (_user, _chosen, _now, _qty);

    _market_remaining := _market_remaining - _qty;
    _total_fish := _total_fish + _qty;

    -- Atomic dock+restart: the player never has to press stop/start manually.
    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = _now,
           last_fishing_reward_at = _now
     WHERE id = _ship.id;

    _ships_processed := _ships_processed + 1;
    _total_cycles := _total_cycles + 1;
  END LOOP;

  -- PASS 2: launch every healthy idle ship immediately while storage has room.
  IF NOT _market_full THEN
    FOR _ship IN
      SELECT s.*
        FROM public.ships_owned s
       WHERE s.user_id = _user
         AND s.in_storage = false
         AND s.stealing_target_user_id IS NULL
         AND s.stealing_ends_at IS NULL
         AND (s.at_sea = false OR s.fishing_started_at IS NULL)
       ORDER BY s.acquired_at ASC
    LOOP
      IF _ship.max_hp IS NOT NULL AND _ship.max_hp > 0 AND _ship.hp IS NOT NULL THEN
        IF (_ship.hp::numeric / _ship.max_hp::numeric) < 0.30 THEN
          CONTINUE;
        END IF;
      ELSIF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > _now THEN
        IF public._ship_repair_ratio(_ship.destroyed_at, _ship.repair_ends_at) < 0.30 THEN
          CONTINUE;
        END IF;
      END IF;

      UPDATE public.ships_owned
         SET at_sea = true,
             fishing_started_at = _now,
             last_fishing_reward_at = COALESCE(last_fishing_reward_at, _now)
       WHERE id = _ship.id;

      _ships_launched := _ships_launched + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'ships', _ships_processed,
    'launched', _ships_launched,
    'cycles', _total_cycles,
    'fish_added', _total_fish,
    'market_full', _market_full,
    'waiting_for_space', _ships_waiting_for_space
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.golden_fisher_tick_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _u record;
  _res jsonb;
  _users int := 0;
  _cycles int := 0;
  _ships int := 0;
  _launched int := 0;
  _fish_added bigint := 0;
  _waiting int := 0;
BEGIN
  PERFORM public.sweep_expired_crews();

  FOR _u IN
    SELECT DISTINCT id
    FROM (
      SELECT p.id
        FROM public.profiles p
       WHERE p.golden_fisher_until IS NOT NULL AND p.golden_fisher_until > now()
      UNION
      SELECT i.user_id AS id
        FROM public.inventory i
       WHERE i.item_type = 'crew'
         AND i.item_id = 'golden_fisher'
         AND i.meta ? 'expires_at'
         AND (i.meta->>'expires_at')::timestamptz > now()
    ) active_users
  LOOP
    _res := public.golden_fisher_tick(_u.id);
    _users := _users + 1;
    _cycles := _cycles + COALESCE((_res->>'cycles')::int, 0);
    _ships := _ships + COALESCE((_res->>'ships')::int, 0);
    _launched := _launched + COALESCE((_res->>'launched')::int, 0);
    _fish_added := _fish_added + COALESCE((_res->>'fish_added')::bigint, 0);
    _waiting := _waiting + COALESCE((_res->>'waiting_for_space')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'users', _users,
    'cycles', _cycles,
    'ships', _ships,
    'launched', _launched,
    'fish_added', _fish_added,
    'waiting_for_space', _waiting
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick_all() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick_all() FROM anon;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick_all() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'golden-fisher-tick';

    PERFORM cron.schedule(
      'golden-fisher-tick',
      '5 seconds',
      'SELECT public.golden_fisher_tick_all();'
    );
  END IF;
END $$;