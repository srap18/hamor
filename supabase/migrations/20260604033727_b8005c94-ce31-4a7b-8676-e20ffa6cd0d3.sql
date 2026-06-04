
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

  -- Shield no longer prevents stealing.

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

  _secs := 60;
  IF _has_thief THEN _secs := GREATEST(20, (_secs * 0.6)::int); END IF;
  _ends := now() + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = NULL,
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id AND user_id = _me;

  ends_at := _ends;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.steal_fish(_defender_id uuid, _max_count integer DEFAULT 5, _attacker_ship_id uuid DEFAULT NULL::uuid, _target_ship_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _moved integer := 0;
  _value bigint := 0;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _defender_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF _max_count IS NULL OR _max_count < 1 THEN _max_count := 1; END IF;
  IF _max_count > 20 THEN _max_count := 20; END IF;

  -- Shield no longer prevents stealing.

  WITH picked AS (
    SELECT id, base_value FROM public.fish_stock
    WHERE user_id = _defender_id
    ORDER BY base_value DESC, caught_at ASC
    LIMIT _max_count
    FOR UPDATE SKIP LOCKED
  ), moved AS (
    UPDATE public.fish_stock fs
       SET user_id = _attacker, caught_at = now(), ship_id = _attacker_ship_id
      FROM picked
     WHERE fs.id = picked.id
    RETURNING picked.base_value AS v
  )
  SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint
    INTO _moved, _value FROM moved;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
 RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _pool jsonb;
  _max integer;
  _moved integer := 0;
  _value bigint := 0;
  _target_ship_id uuid;
  _target_user_id uuid;
  _ratio numeric := 1;
  _elapsed numeric;
  _total numeric;
  _summary jsonb := '[]'::jsonb;
  _target_storage integer;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _my_ship FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _my_ship.stealing_target_user_id IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;

  IF NOT _force AND (_my_ship.stealing_ends_at IS NULL OR _my_ship.stealing_ends_at > now()) THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  IF _force AND _my_ship.stealing_ends_at IS NOT NULL AND _my_ship.stealing_ends_at > now() THEN
    SELECT COALESCE(sc.fishing_seconds, 60) * 2 INTO _total
    FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
    IF _total IS NULL OR _total < 1 THEN _total := 120; END IF;
    _elapsed := GREATEST(0, _total - EXTRACT(EPOCH FROM (_my_ship.stealing_ends_at - now())));
    _ratio := LEAST(1, GREATEST(0, _elapsed / _total));
  END IF;

  _target_ship_id := _my_ship.stealing_target_ship_id;
  _target_user_id := _my_ship.stealing_target_user_id;

  -- Shield no longer prevents stealing.

  SELECT sc.fish_pool, COALESCE(sc.storage, 10)
    INTO _pool, _target_storage
  FROM public.ships_owned so
  JOIN public.ship_catalog sc ON sc.code = so.catalog_code
  WHERE so.id = _target_ship_id AND so.user_id = _target_user_id;
  IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;
  IF _target_storage IS NULL OR _target_storage < 1 THEN _target_storage := 10; END IF;

  _max := GREATEST(1, FLOOR(_target_storage * _ratio)::int);

  WITH pool_ids AS (
    SELECT jsonb_array_elements_text(_pool) AS fid
  ),
  picked AS (
    SELECT fs.id, fs.base_value, fs.fish_id
      FROM public.fish_stock fs
     WHERE fs.user_id = _target_user_id
       AND fs.fish_id IN (SELECT fid FROM pool_ids)
     ORDER BY fs.base_value DESC, fs.caught_at ASC
     LIMIT _max
     FOR UPDATE SKIP LOCKED
  ),
  moved AS (
    UPDATE public.fish_stock fs
       SET user_id = _me, caught_at = now(), ship_id = _attacker_ship_id
      FROM picked
     WHERE fs.id = picked.id
    RETURNING picked.base_value AS v, picked.fish_id AS fid
  )
  SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint,
         COALESCE(jsonb_agg(jsonb_build_object('fish_id', fid, 'value', v)), '[]'::jsonb)
    INTO _moved, _value, _summary FROM moved;

  IF _moved = 0 THEN
    WITH picked AS (
      SELECT fs.id, fs.base_value, fs.fish_id
        FROM public.fish_stock fs
       WHERE fs.user_id = _target_user_id
       ORDER BY fs.base_value DESC, fs.caught_at ASC
       LIMIT _max
       FOR UPDATE SKIP LOCKED
    ),
    moved AS (
      UPDATE public.fish_stock fs
         SET user_id = _me, caught_at = now(), ship_id = _attacker_ship_id
        FROM picked
       WHERE fs.id = picked.id
      RETURNING picked.base_value AS v, picked.fish_id AS fid
    )
    SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint,
           COALESCE(jsonb_agg(jsonb_build_object('fish_id', fid, 'value', v)), '[]'::jsonb)
      INTO _moved, _value, _summary FROM moved;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;
  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value, _summary;
END;
$function$;
