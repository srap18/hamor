CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _ratio numeric;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  PERFORM public._detect_bot_and_ban(_uid, CASE WHEN _at_sea THEN 'ship_start' ELSE 'ship_stop' END);
  IF EXISTS (
    SELECT 1 FROM public.bans
    WHERE user_id = _uid
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT user_id, at_sea, fishing_started_at, destroyed_at, repair_ends_at, hp, max_hp
    INTO _row
    FROM public.ships_owned
   WHERE id = _ship_id
   FOR UPDATE;

  IF _row.user_id IS NULL OR _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  _ratio := CASE
    WHEN COALESCE(_row.max_hp, 0) > 0
      THEN COALESCE(_row.hp, 0)::numeric / _row.max_hp::numeric
    ELSE 1
  END;

  IF _row.destroyed_at IS NOT NULL
     AND _row.repair_ends_at IS NOT NULL
     AND _row.repair_ends_at > now() THEN
    _ratio := LEAST(_ratio, public._ship_repair_ratio(_row.destroyed_at, _row.repair_ends_at));
  END IF;

  IF _at_sea THEN
    IF _ratio < 0.30 THEN
      UPDATE public.ships_owned
         SET at_sea = false,
             fishing_started_at = NULL
       WHERE id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;

    IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      RETURN;
    END IF;

    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = now()
     WHERE id = _ship_id;
    RETURN;
  END IF;

  -- A destroyed ship cannot harvest. Dock it directly instead of calling the
  -- collection function, whose ship_destroyed exception would roll back the dock.
  IF _ratio < 0.30 THEN
    UPDATE public.ships_owned
       SET at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship_id;
    RETURN;
  END IF;

  -- Healthy manual stops harvest and dock atomically. If storage is full the
  -- exception rolls back, preserving the fishing trip so no catch is discarded.
  IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
    PERFORM 1 FROM public.collect_fishing_reward(_ship_id, NULL::text, NULL::integer);
    RETURN;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL
   WHERE id = _ship_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_ship_at_sea(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ship_at_sea(uuid, boolean) TO authenticated, service_role;

UPDATE public.ships_owned
   SET at_sea = false,
       fishing_started_at = NULL
 WHERE at_sea = true
   AND COALESCE(max_hp, 0) > 0
   AND COALESCE(hp, 0)::numeric / max_hp::numeric < 0.30;