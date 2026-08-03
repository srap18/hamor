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
  IF EXISTS (SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
             AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT user_id, at_sea, fishing_started_at, destroyed_at, repair_ends_at
    INTO _row
    FROM public.ships_owned
   WHERE id = _ship_id
   FOR UPDATE;

  IF _row.user_id IS NULL OR _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  IF _at_sea AND _row.destroyed_at IS NOT NULL AND _row.repair_ends_at IS NOT NULL AND _row.repair_ends_at > now() THEN
    _ratio := public._ship_repair_ratio(_row.destroyed_at, _row.repair_ends_at);
    IF _ratio < 0.30 THEN
      UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
  END IF;

  IF _at_sea THEN
    IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      RETURN;
    END IF;
    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = now()
     WHERE id = _ship_id;
  ELSE
    -- Manual stop must ALWAYS harvest first, otherwise the whole trip is lost.
    -- collect_fishing_reward docks the ship itself and raises on market_full
    -- (leaving the ship fishing so nothing is thrown away).
    IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      PERFORM 1 FROM public.collect_fishing_reward(_ship_id, NULL::text, NULL::integer);
      RETURN;
    END IF;

    UPDATE public.ships_owned
       SET at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship_id;
  END IF;
END;
$function$;