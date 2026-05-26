-- Allow start_steal_mission to auto-clear an already-expired previous mission
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
  _prot timestamptz;
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

  SELECT steal_blocked_until INTO _blk FROM public.profiles WHERE id = _me;
  IF _blk IS NOT NULL AND _blk > now() THEN
    RAISE EXCEPTION 'thief blocked until %', _blk;
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF NOT FOUND THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'ship is destroyed'; END IF;
  IF _my_ship.repair_ends_at IS NOT NULL AND _my_ship.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  -- Auto-clear an expired previous steal mission (loot is forfeited)
  IF _my_ship.stealing_target_user_id IS NOT NULL
     AND _my_ship.stealing_ends_at IS NOT NULL
     AND _my_ship.stealing_ends_at <= now() THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    _my_ship.at_sea := false;
    _my_ship.stealing_target_user_id := NULL;
    _my_ship.stealing_ends_at := NULL;
  END IF;

  IF _my_ship.at_sea THEN RAISE EXCEPTION 'ship is busy at sea'; END IF;
  IF _my_ship.stealing_target_user_id IS NOT NULL THEN RAISE EXCEPTION 'ship already on a mission'; END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'target ship not found'; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  SELECT COALESCE(sc.fishing_seconds, 30) INTO _secs
  FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
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
$function$;

-- Clean stuck expired mission rows (forfeit unclaimed loot)
UPDATE public.ships_owned
   SET at_sea = false, fishing_started_at = NULL,
       stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
 WHERE stealing_target_user_id IS NOT NULL
   AND stealing_ends_at IS NOT NULL
   AND stealing_ends_at <= now();