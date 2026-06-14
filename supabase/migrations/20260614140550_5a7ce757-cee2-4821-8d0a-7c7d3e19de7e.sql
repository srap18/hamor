
-- 1) Golden fisher: remove the shield. Activation no longer touches protection_until.
CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
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
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT golden_fisher_until INTO _current
  FROM public.profiles WHERE id = _uid FOR UPDATE;

  IF _current IS NOT NULL AND _current > now() THEN
    _tick := public.golden_fisher_tick(_uid);
    RETURN jsonb_build_object('ok', true, 'already_active', true, 'until', _current, 'tick', _tick);
  END IF;

  SELECT * INTO _row
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = 'golden_fisher'
    AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    AND quantity > 0
  ORDER BY acquired_at ASC
  FOR UPDATE LIMIT 1;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'no_golden_fisher_in_inventory';
  END IF;

  IF _row.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
  END IF;

  _new_until := now() + interval '24 hours';

  -- NOTE: protection_until intentionally NOT updated — golden fisher no longer grants a shield.
  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now()
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET fishing_started_at = COALESCE(fishing_started_at, now()),
         at_sea = true
   WHERE user_id = _uid
     AND in_storage = false
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= now())
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object('ok', true, 'already_active', false, 'until', _new_until, 'tick', _tick);
END;
$function$;

-- 2) Repair crews: actually grant the advertised 60-second shield.
CREATE OR REPLACE FUNCTION public.repair_ship_with_crew(_ship_id uuid, _crew_id text)
RETURNS TABLE(new_hp integer, max_hp integer, repair_ends_at timestamp with time zone, repaired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _ship record;
  _heal integer;
  _new_hp integer;
  _count integer := 0;
  _shield_until timestamptz := now() + interval '60 seconds';
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

    -- Grant 60s shield
    UPDATE public.profiles
       SET protection_until = GREATEST(COALESCE(protection_until, now()), _shield_until)
     WHERE id = _uid;

    IF _inv.quantity <= 1 THEN
      DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
    ELSE
      UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
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

  SELECT so.* INTO _ship
  FROM public.ships_owned AS so
  WHERE so.id = _ship_id AND so.user_id = _uid
  FOR UPDATE;

  IF _ship.id IS NULL THEN RAISE EXCEPTION 'not your ship'; END IF;
  IF COALESCE(_ship.hp, 0) >= COALESCE(_ship.max_hp, 100)
     AND _ship.destroyed_at IS NULL
     AND _ship.repair_ends_at IS NULL THEN
    RAISE EXCEPTION 'ship does not need repair';
  END IF;

  _new_hp := LEAST(COALESCE(_ship.max_hp, 100), GREATEST(0, COALESCE(_ship.hp, 0)) + _heal);

  UPDATE public.ships_owned AS so
     SET hp = _new_hp,
         destroyed_at = CASE WHEN _new_hp >= COALESCE(so.max_hp, 100) THEN NULL ELSE so.destroyed_at END,
         repair_ends_at = CASE WHEN _new_hp >= COALESCE(so.max_hp, 100) THEN NULL ELSE so.repair_ends_at END
   WHERE so.id = _ship.id;

  -- Grant 60s shield
  UPDATE public.profiles
     SET protection_until = GREATEST(COALESCE(protection_until, now()), _shield_until)
   WHERE id = _uid;

  IF _inv.quantity <= 1 THEN
    DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
  ELSE
    UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
  END IF;

  RETURN QUERY
    SELECT s.hp, s.max_hp, s.repair_ends_at, 1
    FROM public.ships_owned AS s
    WHERE s.id = _ship.id;
END $function$;
