
-- 1) collect_fishing_reward: cap by REMAINING capacity (existing stock on this ship)
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len integer;
  _chosen text;
  _capacity integer;
  _existing integer;
  _remaining_cap integer;
  _duration integer;
  _elapsed numeric;
  _ratio numeric;
  _sailor_mult numeric := 1;
  _luck_mult integer := 1;
  _has_crew boolean := false;
  _base integer;
  _qty integer;
  _xp integer;
  _unit_value bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
    RAISE EXCEPTION 'ship_destroyed';
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

  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'sailor' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _sailor_mult := 1.4; END IF;
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
  _capacity := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32 THEN COALESCE(_ship.max_hp, _cat.storage, 10) ELSE COALESCE(_cat.storage, 10) END);

  -- Remaining capacity = ship max − fish already on this ship
  SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int INTO _existing
    FROM public.fish_stock WHERE user_id = _uid AND ship_id = _ship_id;
  _remaining_cap := GREATEST(0, _capacity - _existing);

  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);
  _base := FLOOR(_capacity * _ratio)::integer;
  _base := GREATEST(_base, 0);
  _base := LEAST(_base, _capacity);
  _qty := _base * _luck_mult;
  -- Hard cap by remaining ship capacity
  _qty := LEAST(_qty, _remaining_cap);
  IF _qty < 0 THEN _qty := 0; END IF;
  _xp := CASE WHEN _qty > 0 THEN LEAST(50 + COALESCE(_ship.template_id, 1) * 40, GREATEST(5, FLOOR(_qty * 0.4)::integer + COALESCE(_ship.template_id, 1) * 5)) ELSE 0 END;

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
    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
  END IF;

  fish_id := _chosen;
  fish_qty := _qty;
  base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base);
  xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer;
  duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;

-- 2) start_steal_mission: per-ship police check (only target ship)
CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
 RETURNS TABLE(ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
  _bypass boolean := false;
  _has_police boolean;
  _has_thief boolean;
  _started timestamptz := now();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

  IF NOT public.has_pvp_fleet(_me) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_user_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id AND user_id = _me
     AND stealing_target_user_id IS NOT NULL
     AND stealing_ends_at IS NOT NULL
     AND stealing_ends_at <= now();

  SELECT steal_blocked_until INTO _blk FROM public.profiles WHERE id = _me;
  IF _blk IS NOT NULL AND _blk > now() THEN
    RAISE EXCEPTION 'thief blocked until %', _blk;
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF NOT FOUND THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'ship is destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'ship is busy at sea'; END IF;
  IF _my_ship.repair_ends_at IS NOT NULL AND _my_ship.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF _their_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'target ship destroyed'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.stealing_target_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'target not fishing';
  END IF;

  IF _their_ship.fishing_started_at IS NULL THEN
    UPDATE public.ships_owned SET fishing_started_at = now()
     WHERE id = _target_ship_id AND fishing_started_at IS NULL;
    _their_ship.fishing_started_at := now();
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE stealing_target_ship_id = _target_ship_id
       AND stealing_ends_at IS NOT NULL AND stealing_ends_at > now()
  ) THEN
    RAISE EXCEPTION 'target ship already being raided';
  END IF;

  -- Police only protects the ship it is assigned to
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _target_user_id
       AND item_type = 'crew' AND item_id = 'police' AND quantity > 0
       AND meta->>'assigned_ship_id' = _target_ship_id::text
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_police;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _me
       AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_thief;

  IF _has_police THEN
    IF _has_thief AND random() < 0.8 THEN
      _bypass := true;
    ELSE
      UPDATE public.profiles SET steal_blocked_until = now() + interval '1 hour' WHERE id = _me;
      RAISE EXCEPTION 'caught by police';
    END IF;
  END IF;

  SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
  _secs := GREATEST(1, CEIL(COALESCE(_cat.fishing_seconds, 30) * 0.9)::int);
  IF _has_thief THEN _secs := GREATEST(1, CEIL(_secs * 0.6)::int); END IF;
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true, fishing_started_at = _started,
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id AND user_id = _me;

  ends_at := _ends;
  RETURN NEXT;
END;
$function$;

-- 3) cancel_steal_mission: cap take by attacker's remaining ship capacity
CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _pool jsonb;
  _max integer;
  _existing integer;
  _remaining_cap integer;
  _scaled integer;
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
  _ratio numeric := 0;
  _duration numeric;
  _elapsed numeric;
  _target_ship_id uuid;
  _target_user_id uuid;
  _remaining integer;
  _take integer;
  _row record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN RAISE EXCEPTION 'not allowed'; END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL
     WHERE id = _target_ship_id AND user_id = _target_user_id;
    RETURN QUERY SELECT 0, 0::bigint; RETURN;
  END IF;

  IF _ship.fishing_started_at IS NULL OR _ship.stealing_ends_at IS NULL THEN
    _ratio := 0;
  ELSE
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _ship.fishing_started_at)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _ship.fishing_started_at)));
    _ratio := LEAST(1, _elapsed / _duration);
  END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code;
  _max := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32
                           THEN COALESCE(_ship.max_hp, _cat.storage, 10)
                           ELSE COALESCE(_cat.storage, 10) END);

  IF _ship.user_id = _me THEN
    -- Cap by remaining capacity on attacker ship
    SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int INTO _existing
      FROM public.fish_stock WHERE user_id = _me AND ship_id = _attacker_ship_id;
    _remaining_cap := GREATEST(0, _max - _existing);
    _scaled := LEAST(FLOOR(_max * _ratio)::int, _remaining_cap);
    IF _scaled < 0 THEN _scaled := 0; END IF;
  ELSE
    _scaled := 0;
  END IF;

  IF _scaled > 0 THEN
    _remaining := _scaled;

    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so JOIN public.ship_catalog sc ON sc.code = so.catalog_code
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    FOR _row IN
      WITH pool_ids AS (SELECT jsonb_array_elements_text(_pool) AS fid)
      SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
      FROM public.fish_stock fs
      WHERE fs.user_id = _target_user_id
        AND fs.fish_id IN (SELECT fid FROM pool_ids)
        AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
      ORDER BY fs.base_value DESC, fs.caught_at ASC FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _row.quantity);
      IF _take <= 0 THEN CONTINUE; END IF;
      IF _take >= _row.quantity THEN DELETE FROM public.fish_stock WHERE id = _row.id;
      ELSE UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
      END IF;
      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_ship.user_id, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);
      _moved := _moved + _take;
      _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
      _remaining := _remaining - _take;
    END LOOP;

    IF _remaining > 0 THEN
      FOR _row IN
        SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
        FROM public.fish_stock fs
        WHERE fs.user_id = _target_user_id
          AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
        ORDER BY fs.base_value DESC, fs.caught_at ASC FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN _remaining <= 0;
        _take := LEAST(_remaining, _row.quantity);
        IF _take <= 0 THEN CONTINUE; END IF;
        IF _take >= _row.quantity THEN DELETE FROM public.fish_stock WHERE id = _row.id;
        ELSE UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
        END IF;
        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_ship.user_id, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);
        _moved := _moved + _take;
        _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;
  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;

-- 4) assign_crew_to_ship: when assigning police, instantly catch any active raid on this ship
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
  _expires timestamptz := now() + interval '24 hours';
  _new_id uuid;
  _raider record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _ship_id IS NULL THEN RAISE EXCEPTION 'missing ship'; END IF;
  IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew'; END IF;

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
    UPDATE public.inventory SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
     WHERE id = _inv_id;
    _new_id := _inv_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, 'crew', _crew_id, 1, jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires))
    RETURNING id INTO _new_id;
  END IF;

  -- If police, instantly catch every active thief raiding this ship
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
