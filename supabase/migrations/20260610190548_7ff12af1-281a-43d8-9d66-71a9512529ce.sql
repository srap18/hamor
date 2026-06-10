-- 1) Record assignment time when assigning a crew to a ship
CREATE OR REPLACE FUNCTION public.use_crew_from_inventory(_inventory_id uuid, _ship_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.inventory%ROWTYPE;
  _ship public.ships_owned%ROWTYPE;
  _ship_owner uuid;
  _crew_id text;
  _expires timestamptz := now() + interval '24 hours';
  _trader_ends timestamptz;
  _snap jsonb;
  _anchor timestamptz;
  _new_id uuid;
  _heal integer;
  _new_hp integer;
  _affected integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _row FROM public.inventory WHERE id = _inventory_id FOR UPDATE;
  IF _row.id IS NULL OR _row.user_id <> _uid OR _row.item_type <> 'crew' OR _row.quantity < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;
  IF _row.meta IS NOT NULL AND _row.meta->>'assigned_ship_id' IS NOT NULL THEN
    RAISE EXCEPTION 'crew already used';
  END IF;

  _crew_id := _row.item_id;

  IF _crew_id = 'trader' THEN
    IF _row.quantity = 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
    ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
    _trader_ends := now() + interval '10 hours';
    _snap := public.build_trader_snapshot();
    _anchor := public.trader_snapshot_anchor();
    INSERT INTO public.user_market_state(user_id, trader_until, trader_snapshot, trader_anchor)
      VALUES (_uid, _trader_ends, _snap, _anchor)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
          trader_snapshot = EXCLUDED.trader_snapshot,
          trader_anchor = EXCLUDED.trader_anchor,
          updated_at = now();
    RETURN jsonb_build_object('ok', true, 'kind', 'trader', 'until', _trader_ends);
  END IF;

  IF _ship_id IS NULL THEN RAISE EXCEPTION 'missing ship'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  _ship_owner := _ship.user_id;
  IF _ship.id IS NULL OR _ship_owner <> _uid THEN RAISE EXCEPTION 'ship not found'; END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL,
           at_sea = false, fishing_started_at = NULL
     WHERE user_id = _uid
       AND (COALESCE(hp, 0) < COALESCE(max_hp, 100) OR destroyed_at IS NOT NULL OR repair_ends_at IS NOT NULL);
    GET DIAGNOSTICS _affected = ROW_COUNT;
    IF _affected < 1 THEN RAISE EXCEPTION 'no ships need repair'; END IF;
    IF _row.quantity = 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
    ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'repair_all', 'repaired_count', _affected);
  END IF;

  IF _crew_id IN ('fixer_1','fixer_2','fixer_3') THEN
    IF COALESCE(_ship.hp, 0) >= COALESCE(_ship.max_hp, 100)
       AND _ship.destroyed_at IS NULL AND _ship.repair_ends_at IS NULL THEN
      RAISE EXCEPTION 'ship does not need repair';
    END IF;
    _heal := CASE _crew_id WHEN 'fixer_1' THEN 1000 WHEN 'fixer_2' THEN 5000 WHEN 'fixer_3' THEN 70000 ELSE 0 END;
    _new_hp := LEAST(COALESCE(_ship.max_hp, 100), GREATEST(0, COALESCE(_ship.hp, 0)) + _heal);
    UPDATE public.ships_owned
       SET hp = _new_hp,
           destroyed_at = CASE WHEN _new_hp >= COALESCE(max_hp, 100) THEN NULL ELSE destroyed_at END,
           repair_ends_at = CASE WHEN _new_hp >= COALESCE(max_hp, 100) THEN NULL ELSE repair_ends_at END
     WHERE id = _ship_id AND user_id = _uid;
    IF _row.quantity = 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
    ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'repair_ship', 'ship_id', _ship_id, 'new_hp', _new_hp, 'max_hp', _ship.max_hp);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory
    WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
      AND meta->>'assigned_ship_id' = _ship_id::text
      AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) THEN
    RAISE EXCEPTION 'ship already has this crew';
  END IF;

  IF _row.quantity = 1 THEN
    UPDATE public.inventory
       SET meta = jsonb_build_object(
         'assigned_ship_id', _ship_id::text,
         'expires_at', _expires,
         'assigned_at', now()
       )
     WHERE id = _row.id;
    _new_id := _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, 'crew', _crew_id, 1, jsonb_build_object(
      'assigned_ship_id', _ship_id::text,
      'expires_at', _expires,
      'assigned_at', now()
    ))
    RETURNING id INTO _new_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', 'assigned', 'id', _new_id, 'ship_id', _ship_id, 'until', _expires);
END;
$function$;

-- 2) Fishing reward only honors sailor speed-up if sailor was assigned BEFORE the trip started.
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
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _still_repairing boolean := false;
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

  -- Sailor speed-up: only if assigned BEFORE this trip started (matches UI sailorAtStart).
  -- Legacy rows without an assigned_at are treated as "assigned at trip start" (no boost retro-applied).
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
  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _has_crew AND _requested_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

  _market_remaining := public.user_market_remaining(_uid);

  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);

  _base := FLOOR(_capacity * _ratio)::integer;
  IF _base <= 0 THEN _base := 1; END IF;
  _base := LEAST(_base, _capacity);

  _qty := _base * _luck_mult;
  IF _market_remaining > 0 THEN
    _qty := LEAST(_qty::bigint, _market_remaining)::int;
    IF _qty < 1 THEN _qty := 1; END IF;
  ELSE
    _qty := 0;
  END IF;

  _xp := 0;

  UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = now() WHERE so.id = _ship_id;

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