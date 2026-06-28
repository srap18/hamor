
SET LOCAL lock_timeout = '30s';

-- Helper: raise if caller's ship market level is below the required minimum
CREATE OR REPLACE FUNCTION public._require_market_level(_min int)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _lvl int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT level INTO _lvl FROM public.user_market WHERE user_id = _uid;
  IF COALESCE(_lvl, 1) < _min THEN
    RAISE EXCEPTION 'crew_requires_market_level_%', _min;
  END IF;
END $$;

-- Inject the gate into each crew-activation function.
-- We patch by recreating the prologue: prepend the guard call after the BEGIN.
-- Easiest reliable approach: re-create each function with the new check at top.

-- 1) use_crew_from_inventory
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
  PERFORM public._require_market_level(10);

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
       SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires, 'assigned_at', now())
     WHERE id = _row.id;
    _new_id := _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid,'crew',_crew_id,1,
      jsonb_build_object('assigned_ship_id', _ship_id::text,'expires_at', _expires,'assigned_at', now()))
    RETURNING id INTO _new_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'kind', 'assigned', 'inventory_id', _new_id, 'expires_at', _expires);
END;
$function$;

-- 2) assign_crew_to_ship — just prepend the guard
CREATE OR REPLACE FUNCTION public.assign_crew_to_ship(_ship_id uuid, _crew_id text)
 RETURNS TABLE(inventory_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship_owner uuid;
  _inv_id uuid;
  _qty integer;
  _assigned_at timestamptz := now();
  _expires timestamptz := now() + interval '24 hours';
  _new_id uuid;
  _raider record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public._require_market_level(10);
  IF _ship_id IS NULL THEN RAISE EXCEPTION 'missing ship'; END IF;
  IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew'; END IF;
  IF _crew_id IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN
    RAISE EXCEPTION 'fixer crew is instant-use only';
  END IF;
  IF _crew_id = 'golden_fisher' THEN
    RAISE EXCEPTION 'golden_fisher is account-wide, not per-ship';
  END IF;
  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _ship_owner IS NULL OR _ship_owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  DELETE FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
    AND meta->>'assigned_ship_id' = _ship_id::text
    AND (meta->>'expires_at') IS NOT NULL
    AND (meta->>'expires_at')::timestamptz <= now();
  IF _crew_id = 'trader' THEN
    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
        AND meta->>'assigned_ship_id' IS NOT NULL
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN RAISE EXCEPTION 'crew already active globally'; END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN RAISE EXCEPTION 'ship already has this crew'; END IF;
  END IF;
  SELECT id, quantity INTO _inv_id, _qty
  FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at, id LIMIT 1 FOR UPDATE;
  IF _inv_id IS NULL THEN RAISE EXCEPTION 'no such crew'; END IF;
  IF _qty <= 1 THEN
    UPDATE public.inventory
       SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text,'assigned_at', _assigned_at,'expires_at', _expires)
     WHERE id = _inv_id;
    _new_id := _inv_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid,'crew',_crew_id,1,
      jsonb_build_object('assigned_ship_id', _ship_id::text,'assigned_at', _assigned_at,'expires_at', _expires))
    RETURNING id INTO _new_id;
  END IF;
  IF _crew_id = 'police' THEN
    FOR _raider IN
      SELECT id, user_id FROM public.ships_owned
      WHERE stealing_target_ship_id = _ship_id
        AND stealing_target_user_id = _uid
        AND stealing_ends_at IS NOT NULL AND stealing_ends_at > now()
      FOR UPDATE
    LOOP
      UPDATE public.profiles SET steal_blocked_until = now() + interval '1 hour'
       WHERE id = _raider.user_id;
      UPDATE public.ships_owned
         SET at_sea = false, fishing_started_at = NULL,
             stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
       WHERE id = _raider.id;
    END LOOP;
  END IF;
  inventory_id := _new_id;
  expires_at := _expires;
  RETURN NEXT;
END;
$function$;

-- 3) Add guard at top of activate_market_expert (we only need to add one PERFORM line; recreate full body)
CREATE OR REPLACE FUNCTION public.activate_market_expert()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _current timestamptz;
  _new_until timestamptz;
  _base timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT market_expert_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row
    FROM public.inventory
   WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'market_expert'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL) AND quantity > 0
   ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NULL THEN RAISE EXCEPTION 'no_market_expert_in_inventory'; END IF;

  IF _row.quantity <= 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
  ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;

  _base := GREATEST(COALESCE(_current, now()), now());
  _new_until := _base + interval '3 hours';
  UPDATE public.profiles SET market_expert_until = _new_until WHERE id = _uid;
  RETURN jsonb_build_object('ok', true, 'until', _new_until);
END;
$function$;

-- 4) Add guard at top of buy_trader_unlock
CREATE OR REPLACE FUNCTION public.buy_trader_unlock()
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cost int; _inv_id uuid; _ends timestamptz; _bal int; _snap jsonb; _anchor timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  PERFORM public._require_market_level(10);

  SELECT id INTO _inv_id FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'trader' AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at LIMIT 1;
  IF _inv_id IS NOT NULL THEN
    SELECT (public.use_crew_from_inventory(_inv_id, NULL)->>'until')::timestamptz INTO _ends;
    RETURN _ends;
  END IF;

  SELECT price_gems INTO _cost FROM public.client_item_prices WHERE item_type = 'crew' AND item_id = 'trader';
  IF _cost IS NULL OR _cost <= 0 THEN
    SELECT price_gems INTO _cost FROM public.items_catalog WHERE code = 'trader_unlock';
  END IF;
  IF _cost IS NULL OR _cost <= 0 THEN _cost := 250; END IF;

  SELECT gems INTO _bal FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _bal IS NULL OR _bal < _cost THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;
  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid;

  _ends := now() + interval '10 hours';
  _snap := public.build_trader_snapshot();
  _anchor := public.trader_snapshot_anchor();
  INSERT INTO public.user_market_state(user_id, trader_until, trader_snapshot, trader_anchor)
    VALUES (_uid, _ends, _snap, _anchor)
  ON CONFLICT (user_id) DO UPDATE
    SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
        trader_snapshot = EXCLUDED.trader_snapshot,
        trader_anchor = EXCLUDED.trader_anchor,
        updated_at = now();
  RETURN _ends;
END;
$function$;
