CREATE OR REPLACE FUNCTION public.repair_ship_with_crew(_ship_id uuid, _crew_id text)
RETURNS TABLE(new_hp integer, max_hp integer, repair_ends_at timestamp with time zone, repaired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _ship record;
  _heal integer;
  _new_hp integer;
  _repair_secs integer;
  _remaining_secs integer;
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _crew_id NOT IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN RAISE EXCEPTION 'unsupported crew'; END IF;

  SELECT id, quantity INTO _inv
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = _crew_id
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY id ASC
  LIMIT 1
  FOR UPDATE;

  IF _inv.id IS NULL OR COALESCE(_inv.quantity, 0) < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned
       SET hp = max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL,
           at_sea = false,
           fishing_started_at = NULL
     WHERE user_id = _uid
       AND (COALESCE(hp, 0) < COALESCE(max_hp, 100) OR destroyed_at IS NOT NULL OR repair_ends_at IS NOT NULL);
    GET DIAGNOSTICS _count = ROW_COUNT;
    IF _count < 1 THEN RAISE EXCEPTION 'no ships need repair'; END IF;

    IF _inv.quantity <= 1 THEN
      DELETE FROM public.inventory WHERE id = _inv.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv.id;
    END IF;

    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::timestamp with time zone, _count;
    RETURN;
  END IF;

  _heal := CASE _crew_id
    WHEN 'fixer_1' THEN 1000
    WHEN 'fixer_2' THEN 5000
    WHEN 'fixer_3' THEN 70000
    ELSE 0
  END;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _ship_id AND user_id = _uid
  FOR UPDATE;

  IF _ship.id IS NULL THEN RAISE EXCEPTION 'not your ship'; END IF;
  IF COALESCE(_ship.hp, 0) >= COALESCE(_ship.max_hp, 100)
     AND _ship.destroyed_at IS NULL
     AND _ship.repair_ends_at IS NULL THEN
    RAISE EXCEPTION 'ship does not need repair';
  END IF;

  _new_hp := LEAST(COALESCE(_ship.max_hp, 100), GREATEST(0, COALESCE(_ship.hp, 0)) + _heal);

  IF COALESCE(_ship.template_id, 1) <= 10 THEN
    _repair_secs := ROUND(3600 + (COALESCE(_ship.template_id, 1) - 1) * (18000 - 3600) / 9.0);
  ELSIF COALESCE(_ship.template_id, 1) <= 20 THEN
    _repair_secs := ROUND(18000 + (COALESCE(_ship.template_id, 1) - 11) * (36000 - 18000) / 9.0);
  ELSIF COALESCE(_ship.template_id, 1) <= 25 THEN
    _repair_secs := ROUND(39600 + (COALESCE(_ship.template_id, 1) - 21) * (72000 - 39600) / 4.0);
  ELSE
    _repair_secs := ROUND(75600 + (COALESCE(_ship.template_id, 1) - 26) * (86400 - 75600) / 4.0);
  END IF;

  IF _new_hp >= COALESCE(_ship.max_hp, 100) THEN
    UPDATE public.ships_owned
       SET hp = _new_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL,
           at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship.id;
  ELSE
    _remaining_secs := GREATEST(1, CEIL(_repair_secs * ((COALESCE(_ship.max_hp, 100) - _new_hp)::numeric / GREATEST(1, COALESCE(_ship.max_hp, 100))))::integer);
    UPDATE public.ships_owned
       SET hp = _new_hp,
           destroyed_at = COALESCE(destroyed_at, now()),
           repair_ends_at = now() + make_interval(secs => _remaining_secs),
           at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship.id;
  END IF;

  IF _inv.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _inv.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv.id;
  END IF;

  RETURN QUERY
    SELECT s.hp, s.max_hp, s.repair_ends_at, 1
    FROM public.ships_owned s
    WHERE s.id = _ship.id;
END $$;

GRANT EXECUTE ON FUNCTION public.repair_ship_with_crew(uuid, text) TO authenticated;