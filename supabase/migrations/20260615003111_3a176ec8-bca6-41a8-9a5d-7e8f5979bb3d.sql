
-- 1) finalize_ship_repairs: also tick HP gradually for destroyed ships still repairing
CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Fully restore ships whose timer has ended
  UPDATE public.ships_owned
     SET hp = max_hp,
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE destroyed_at IS NOT NULL
     AND repair_ends_at IS NOT NULL
     AND repair_ends_at <= now();

  -- Gradually heal still-repairing ships: hp = max_hp * elapsed/total
  UPDATE public.ships_owned AS so
     SET hp = LEAST(
                COALESCE(so.max_hp, 100),
                GREATEST(
                  COALESCE(so.hp, 0),
                  FLOOR(
                    COALESCE(so.max_hp, 100)::numeric
                    * EXTRACT(EPOCH FROM (now() - so.destroyed_at))::numeric
                    / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
                  )::integer
                )
              )
   WHERE so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NOT NULL
     AND so.repair_ends_at > now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_ship_repairs() TO anon, authenticated, service_role;

-- 2) repair_ship_with_crew: partial crew heal shrinks remaining time proportionally
CREATE OR REPLACE FUNCTION public.repair_ship_with_crew(_ship_id uuid, _crew_id text)
RETURNS TABLE(new_hp integer, max_hp integer, repair_ends_at timestamp with time zone, repaired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _ship record;
  _heal integer;
  _cur_hp integer;
  _new_hp integer;
  _max integer;
  _total_secs numeric;
  _remaining_secs numeric;
  _new_destroyed timestamptz;
  _new_repair_ends timestamptz;
  _count integer := 0;
  _full boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _crew_id NOT IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN RAISE EXCEPTION 'unsupported crew'; END IF;

  SELECT inv.id, inv.quantity INTO _inv
  FROM public.inventory AS inv
  WHERE inv.user_id = _uid
    AND inv.item_type = 'crew'
    AND inv.item_id = _crew_id
    AND (inv.meta IS NULL OR inv.meta->>'assigned_ship_id' IS NULL)
  ORDER BY inv.acquired_at, inv.id
  LIMIT 1 FOR UPDATE;

  IF _inv.id IS NULL OR COALESCE(_inv.quantity, 0) < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned AS so
       SET hp = so.max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL,
           at_sea = false,
           fishing_started_at = NULL
     WHERE so.user_id = _uid
       AND (COALESCE(so.hp, 0) < COALESCE(so.max_hp, 100) OR so.destroyed_at IS NOT NULL OR so.repair_ends_at IS NOT NULL);
    GET DIAGNOSTICS _count = ROW_COUNT;
    IF _count < 1 THEN RAISE EXCEPTION 'no ships need repair'; END IF;

    IF _inv.quantity <= 1 THEN
      DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
    ELSE
      UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
    END IF;

    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::timestamptz, _count;
    RETURN;
  END IF;

  _heal := CASE _crew_id
    WHEN 'fixer_1' THEN 1000
    WHEN 'fixer_2' THEN 5000
    WHEN 'fixer_3' THEN 70000
    ELSE 0
  END;

  SELECT so.* INTO _ship
  FROM public.ships_owned AS so
  WHERE so.id = _ship_id AND so.user_id = _uid
  FOR UPDATE;

  IF _ship.id IS NULL THEN RAISE EXCEPTION 'not your ship'; END IF;
  _max := COALESCE(_ship.max_hp, 100);

  -- If destroyed, compute current HP from elapsed self-heal first.
  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL THEN
    _total_secs := EXTRACT(EPOCH FROM (_ship.repair_ends_at - _ship.destroyed_at))::numeric;
    _cur_hp := LEAST(_max, GREATEST(
      COALESCE(_ship.hp, 0),
      FLOOR(_max::numeric * EXTRACT(EPOCH FROM (now() - _ship.destroyed_at))::numeric
            / NULLIF(_total_secs, 0))::integer
    ));
  ELSE
    _cur_hp := COALESCE(_ship.hp, 0);
    _total_secs := NULL;
  END IF;

  IF _cur_hp >= _max
     AND _ship.destroyed_at IS NULL
     AND _ship.repair_ends_at IS NULL THEN
    RAISE EXCEPTION 'ship does not need repair';
  END IF;

  _new_hp := LEAST(_max, _cur_hp + _heal);
  _full := _new_hp >= _max;

  IF _full THEN
    _new_destroyed := NULL;
    _new_repair_ends := NULL;
  ELSIF _total_secs IS NOT NULL AND _total_secs > 0 THEN
    -- Shrink remaining repair time proportional to HP healed.
    _remaining_secs := _total_secs * (1.0 - _new_hp::numeric / _max::numeric);
    _new_repair_ends := now() + make_interval(secs => _remaining_secs);
    -- Keep destroyed_at consistent so repairProgress(now) = new_hp/max.
    _new_destroyed := _new_repair_ends - make_interval(secs => _total_secs);
  ELSE
    _new_destroyed := _ship.destroyed_at;
    _new_repair_ends := _ship.repair_ends_at;
  END IF;

  UPDATE public.ships_owned AS so
     SET hp = _new_hp,
         destroyed_at = _new_destroyed,
         repair_ends_at = _new_repair_ends,
         at_sea = CASE WHEN _full THEN false ELSE so.at_sea END,
         fishing_started_at = CASE WHEN _full THEN NULL ELSE so.fishing_started_at END
   WHERE so.id = _ship.id;

  IF _inv.quantity <= 1 THEN
    DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
  ELSE
    UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
  END IF;

  RETURN QUERY SELECT _new_hp, _max, _new_repair_ends, 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_ship_with_crew(uuid, text) TO authenticated, service_role;

-- Run once to heal currently-stuck and tick HP for in-progress repairs
SELECT public.finalize_ship_repairs();
