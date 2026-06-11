-- 1) Per-ship preferred fish (survives crew reassignment).
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS preferred_fish_id text;

-- 2) set_guide_fish now writes to ships_owned (authoritative) AND mirrors to
--    any guide inventory row for backward compatibility. No longer rejects
--    when the guide row isn't perfectly tagged with assigned_ship_id.
CREATE OR REPLACE FUNCTION public.set_guide_fish(_ship_db_id uuid, _fish_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_db_id;
  IF _owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ship_not_found');
  END IF;
  IF _owner <> _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_ship');
  END IF;

  UPDATE public.ships_owned
     SET preferred_fish_id = _fish_id
   WHERE id = _ship_db_id;

  -- Best-effort mirror to a guide row scoped to this ship (legacy reads).
  UPDATE public.inventory
     SET meta = COALESCE(meta, '{}'::jsonb)
                || jsonb_build_object('preferred_fish_id', _fish_id)
   WHERE user_id = _uid
     AND item_type = 'crew'
     AND item_id  = 'guide'
     AND (meta->>'assigned_ship_id') = _ship_db_id::text;

  RETURN jsonb_build_object('ok', true);
END
$function$;

-- 3) collect_fishing_reward: prefer ships_owned.preferred_fish_id when a guide
--    is assigned, then fall back to the legacy guide-row meta.
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
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
  _sailor_mult numeric := 1; _luck_mult integer := 1; _has_crew boolean := false;
  _has_guide boolean := false; _guide_pref text;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _still_repairing boolean := false;
  _grace_seconds constant numeric := 5;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    _hp_ratio := public._ship_repair_ratio(_ship.destroyed_at, _ship.repair_ends_at);
    IF _hp_ratio < 0.30 THEN
      UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
    _still_repairing := true;
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

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'sailor'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
      AND (inv.meta->>'assigned_at') IS NOT NULL
      AND (inv.meta->>'assigned_at')::timestamptz <= _ship.fishing_started_at
  ) INTO _has_crew;
  IF _has_crew THEN _sailor_mult := 2.0; END IF;

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

  -- Per-ship preferred fish wins over the legacy guide meta.
  IF _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> '' THEN
    _guide_pref := _ship.preferred_fish_id;
  END IF;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _has_guide AND _requested_fish_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  -- Persist the chosen fish as the ship's preference so future runs
  -- (and the Golden Fisher background tick) stay on the same type.
  IF _has_guide AND _chosen IS NOT NULL
     AND (_ship.preferred_fish_id IS DISTINCT FROM _chosen) THEN
    UPDATE public.ships_owned SET preferred_fish_id = _chosen WHERE id = _ship_id;
    UPDATE public.inventory inv
       SET meta = COALESCE(inv.meta, '{}'::jsonb) || jsonb_build_object('preferred_fish_id', _chosen)
     WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
       AND inv.meta->>'assigned_ship_id' = _ship_id::text;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

  _market_remaining := public.user_market_remaining(_uid);

  IF _market_remaining <= 0 THEN
    RAISE EXCEPTION 'market_full';
  END IF;

  _elapsed := GREATEST(0, (EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) + _grace_seconds) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);

  _base := ROUND(_capacity * _ratio)::integer;
  IF _base <= 0 THEN _base := 1; END IF;
  _base := LEAST(_base, _capacity);

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
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
    SET quantity = public.fish_caught.quantity + _qty,
        total_caught = public.fish_caught.total_caught + _qty,
        updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen;
    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _chosen, _ship_id, now(), _unit_value, _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_uid, _chosen, now(), _qty);
  END IF;

  fish_id := _chosen; fish_qty := _qty; base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base); xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer; duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;

-- 4) golden_fisher_tick: read per-ship preferred_fish_id with legacy fallback.
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
  _seconds_since_sailor numeric;
  _remaining_effective numeric;
  _remaining_wall numeric;
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
      AND at_sea = true
      AND fishing_started_at IS NOT NULL
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

    _has_sailor := false;
    _sailor_assigned_at := NULL;
    SELECT true, NULLIF(i.meta->>'assigned_at','')::timestamptz INTO _has_sailor, _sailor_assigned_at
    FROM public.inventory i
    WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'sailor'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;
    _has_sailor := COALESCE(_has_sailor, false);

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at)));
    _effective_elapsed := _elapsed;
    IF _has_sailor THEN
      IF _sailor_assigned_at IS NULL OR _sailor_assigned_at <= _ship.fishing_started_at THEN
        _effective_elapsed := _elapsed * 2;
      ELSE
        _effective_elapsed := _elapsed + GREATEST(0, EXTRACT(EPOCH FROM (_now - _sailor_assigned_at)));
      END IF;
    END IF;

    _n_cycles := FLOOR(_effective_elapsed / (_duration::numeric * 0.99))::int;

    IF _n_cycles < 1 THEN
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
    SELECT true, NULLIF(i.meta->>'preferred_fish_id','') INTO _has_guide, _preferred
    FROM public.inventory i
    WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'guide'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;
    _has_guide := COALESCE(_has_guide, false);

    -- Per-ship preference wins (set via the picker, independent of crew row state).
    IF _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> '' THEN
      _preferred := _ship.preferred_fish_id;
      _has_guide := true;
    END IF;

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

        _cycles := _cycles + _n_cycles;
      END IF;
    END IF;

    _remaining_effective := GREATEST(0, _effective_elapsed - (_n_cycles * _duration));
    _remaining_wall := _remaining_effective;
    IF _has_sailor THEN
      IF _sailor_assigned_at IS NULL THEN
        _remaining_wall := _remaining_effective / 2;
      ELSE
        _seconds_since_sailor := GREATEST(0, EXTRACT(EPOCH FROM (_now - _sailor_assigned_at)));
        IF _remaining_effective <= (_seconds_since_sailor * 2) THEN
          _remaining_wall := _remaining_effective / 2;
        ELSE
          _remaining_wall := _remaining_effective - _seconds_since_sailor;
        END IF;
      END IF;
    END IF;

    UPDATE public.ships_owned
       SET fishing_started_at = _now - make_interval(secs => GREATEST(0, FLOOR(_remaining_wall))::int),
           last_fishing_reward_at = _now
     WHERE id = _ship.id;

    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END;
$function$;