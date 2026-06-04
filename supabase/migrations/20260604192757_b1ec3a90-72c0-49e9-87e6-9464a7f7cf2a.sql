
-- Helper: compute user's fish market capacity by level
CREATE OR REPLACE FUNCTION public.fish_market_capacity(_level integer)
RETURNS bigint
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE _lvl int := GREATEST(1, LEAST(30, COALESCE(_level, 1))); _cap bigint := 10000; _l int;
BEGIN
  FOR _l IN 2.._lvl LOOP
    IF _l <= 10 THEN _cap := _cap + 10000;
    ELSIF _l <= 20 THEN _cap := _cap + 30000;
    ELSE _cap := _cap + 100000; END IF;
  END LOOP;
  RETURN _cap;
END $$;

CREATE OR REPLACE FUNCTION public.user_market_remaining(_uid uuid)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _lvl int; _cap bigint; _used bigint;
BEGIN
  SELECT COALESCE(level,1) INTO _lvl FROM public.user_fish_market WHERE user_id = _uid;
  IF _lvl IS NULL THEN _lvl := 1; END IF;
  _cap := public.fish_market_capacity(_lvl);
  SELECT COALESCE(SUM(GREATEST(0, quantity)),0)::bigint INTO _used FROM public.fish_stock WHERE user_id = _uid;
  RETURN GREATEST(0, _cap - _used);
END $$;

GRANT EXECUTE ON FUNCTION public.fish_market_capacity(integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_market_remaining(uuid) TO authenticated;

-- Patch collect_fishing_reward: also cap by total market remaining capacity
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record; _cat record; _pool jsonb; _pool_len integer; _chosen text;
  _capacity integer; _existing integer; _remaining_cap integer;
  _market_remaining bigint;
  _duration integer; _elapsed numeric; _ratio numeric;
  _sailor_mult numeric := 1; _luck_mult integer := 1; _has_crew boolean := false;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
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

  SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int INTO _existing
    FROM public.fish_stock WHERE user_id = _uid AND ship_id = _ship_id;
  _remaining_cap := GREATEST(0, _capacity - _existing);

  _market_remaining := public.user_market_remaining(_uid);

  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);
  _base := FLOOR(_capacity * _ratio)::integer;
  _base := GREATEST(_base, 0);
  _base := LEAST(_base, _capacity);
  _qty := _base * _luck_mult;
  _qty := LEAST(_qty, _remaining_cap);
  _qty := LEAST(_qty::bigint, _market_remaining)::int;
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

  fish_id := _chosen; fish_qty := _qty; base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base); xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer; duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;

-- Patch cancel_steal_mission: also cap by attacker's market remaining
CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _pool jsonb;
  _max integer; _existing integer; _remaining_cap integer;
  _market_remaining bigint;
  _scaled integer; _moved integer := 0; _value bigint := 0;
  _prot timestamptz; _ratio numeric := 0; _duration numeric; _elapsed numeric;
  _target_ship_id uuid; _target_user_id uuid;
  _remaining integer; _take integer; _row record;
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
    SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int INTO _existing
      FROM public.fish_stock WHERE user_id = _me AND ship_id = _attacker_ship_id;
    _remaining_cap := GREATEST(0, _max - _existing);
    _market_remaining := public.user_market_remaining(_me);
    _scaled := LEAST(FLOOR(_max * _ratio)::int, _remaining_cap);
    _scaled := LEAST(_scaled::bigint, _market_remaining)::int;
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
