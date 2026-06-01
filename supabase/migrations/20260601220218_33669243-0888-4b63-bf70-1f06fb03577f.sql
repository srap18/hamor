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
  _prot timestamptz;
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

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL
     WHERE id = _target_ship_id AND user_id = _target_user_id;
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb;
    RETURN;
  END IF;

  -- Target ship's storage is the cap
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