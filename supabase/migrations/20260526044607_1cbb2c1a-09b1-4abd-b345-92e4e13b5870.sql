
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS stealing_target_user_id uuid,
  ADD COLUMN IF NOT EXISTS stealing_target_ship_id uuid,
  ADD COLUMN IF NOT EXISTS stealing_ends_at timestamptz;

-- Start a stealing mission with one of my ships against an enemy ship
CREATE OR REPLACE FUNCTION public.start_steal_mission(
  _attacker_ship_id uuid,
  _target_user_id uuid,
  _target_ship_id uuid
)
RETURNS TABLE(ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _prot timestamptz;
  _secs integer;
  _ends timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF NOT FOUND THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'ship is destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'ship is busy at sea'; END IF;
  IF _my_ship.repair_ends_at IS NOT NULL AND _my_ship.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'target ship not found'; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  SELECT COALESCE(sc.fishing_seconds, 30) INTO _secs
  FROM public.ship_catalog sc
  WHERE sc.code = _my_ship.catalog_code;
  IF _secs IS NULL OR _secs < 5 THEN _secs := 30; END IF;

  _ends := now() + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = now(),
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _ends;
END;
$$;

-- Claim a finished stealing mission
CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid)
RETURNS TABLE(stolen_count integer, total_value bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_code text;
  _pool jsonb;
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _my_ship FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _my_ship.stealing_target_user_id IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;
  IF _my_ship.stealing_ends_at IS NULL OR _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  -- protection re-check at claim time
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _my_ship.stealing_target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    -- still reset the mission so ship can be used again
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    RETURN QUERY SELECT 0, 0::bigint;
    RETURN;
  END IF;

  -- enemy ship's fish pool
  SELECT sc.fish_pool INTO _pool
  FROM public.ships_owned so
  JOIN public.ship_catalog sc ON sc.code = so.catalog_code
  WHERE so.id = _my_ship.stealing_target_ship_id
    AND so.user_id = _my_ship.stealing_target_user_id;

  IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

  WITH pool_ids AS (
    SELECT jsonb_array_elements_text(_pool) AS fid
  ),
  picked AS (
    SELECT fs.id, fs.base_value
      FROM public.fish_stock fs
     WHERE fs.user_id = _my_ship.stealing_target_user_id
       AND fs.fish_id IN (SELECT fid FROM pool_ids)
     ORDER BY fs.base_value DESC, fs.caught_at ASC
     LIMIT 5
     FOR UPDATE SKIP LOCKED
  ),
  moved AS (
    UPDATE public.fish_stock fs
       SET user_id = _me, caught_at = now(), ship_id = _attacker_ship_id
      FROM picked
     WHERE fs.id = picked.id
    RETURNING picked.base_value AS v
  )
  SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _moved, _value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_steal_mission(uuid) TO authenticated;
