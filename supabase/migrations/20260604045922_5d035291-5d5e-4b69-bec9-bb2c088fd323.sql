-- Update start_steal_mission: cap by storage capacity (yield), but duration based on tier
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
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
  _bypass boolean := false;
  _has_police boolean;
  _has_thief boolean;
  _power integer;
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
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL
     OR _their_ship.stealing_target_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'target not fishing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE stealing_target_ship_id = _target_ship_id
       AND stealing_ends_at IS NOT NULL
       AND stealing_ends_at > now()
  ) THEN
    RAISE EXCEPTION 'target ship already being raided';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _target_user_id
       AND item_type = 'crew' AND item_id = 'police' AND quantity > 0
       AND meta ? 'assigned_ship_id'
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

  -- Duration scales with attacker tier (fishing_power as a tier proxy, capped).
  SELECT COALESCE(sc.fishing_power, 5) INTO _power
  FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
  IF _power IS NULL OR _power < 1 THEN _power := 5; END IF;
  IF _power > 100 THEN _power := 100; END IF;

  _secs := GREATEST(40, LEAST(180, _power * 6));
  IF _has_thief THEN _secs := GREATEST(20, (_secs * 0.6)::int); END IF;
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = _started,
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id AND user_id = _me;

  ends_at := _ends;
  RETURN NEXT;
END;
$function$;

-- Update cancel_steal_mission: yield capped by attacker ship's storage capacity
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
  _scaled integer;
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
  _ratio numeric := 0;
  _duration numeric;
  _elapsed numeric;
  _target_ship_id uuid;
  _target_user_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL
     WHERE id = _target_ship_id AND user_id = _target_user_id;
    RETURN QUERY SELECT 0, 0::bigint;
    RETURN;
  END IF;

  IF _ship.fishing_started_at IS NULL OR _ship.stealing_ends_at IS NULL THEN
    _ratio := 0;
  ELSE
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _ship.fishing_started_at)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _ship.fishing_started_at)));
    _ratio := LEAST(1, _elapsed / _duration);
  END IF;

  -- Capacity = attacker ship's storage (same metric used for fishing).
  -- Upgradeable ship (template 32) uses max_hp as its current capacity.
  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code;
  _max := GREATEST(1,
    CASE WHEN COALESCE(_ship.template_id, 0) = 32
         THEN COALESCE(_ship.max_hp, _cat.storage, 10)
         ELSE COALESCE(_cat.storage, 10)
    END
  );

  IF _ship.user_id = _me THEN
    _scaled := FLOOR(_max * _ratio)::int;
    IF _scaled < 0 THEN _scaled := 0; END IF;
  ELSE
    _scaled := 0;
  END IF;

  IF _scaled > 0 THEN
    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so
    JOIN public.ship_catalog sc ON sc.code = so.catalog_code
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    WITH pool_ids AS (
      SELECT jsonb_array_elements_text(_pool) AS fid
    ),
    picked AS (
      SELECT fs.id, fs.base_value
        FROM public.fish_stock fs
       WHERE fs.user_id = _target_user_id
         AND fs.fish_id IN (SELECT fid FROM pool_ids)
       ORDER BY fs.base_value DESC, fs.caught_at ASC
       LIMIT _scaled
       FOR UPDATE SKIP LOCKED
    ),
    moved AS (
      UPDATE public.fish_stock fs
         SET user_id = _ship.user_id, caught_at = now(), ship_id = _attacker_ship_id
        FROM picked
       WHERE fs.id = picked.id
      RETURNING picked.base_value AS v
    )
    SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;

    IF _moved = 0 THEN
      WITH picked AS (
        SELECT fs.id, fs.base_value
          FROM public.fish_stock fs
         WHERE fs.user_id = _target_user_id
         ORDER BY fs.base_value DESC, fs.caught_at ASC
         LIMIT _scaled
         FOR UPDATE SKIP LOCKED
      ),
      moved AS (
        UPDATE public.fish_stock fs
           SET user_id = _ship.user_id, caught_at = now(), ship_id = _attacker_ship_id
          FROM picked
         WHERE fs.id = picked.id
        RETURNING picked.base_value AS v
      )
      SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;
    END IF;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;