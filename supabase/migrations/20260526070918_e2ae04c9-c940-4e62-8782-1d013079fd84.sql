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
  _bypass boolean := false;
  _police_row_id uuid;
  _thief_row_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

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

  -- NEW: only one raider per target ship at a time
  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE stealing_target_ship_id = _target_ship_id
       AND stealing_ends_at IS NOT NULL
       AND stealing_ends_at > now()
  ) THEN
    RAISE EXCEPTION 'target ship already being raided';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  -- POLICE check: target has a police crew → attempt to catch the thief.
  SELECT id INTO _police_row_id FROM public.inventory
   WHERE user_id = _target_user_id AND item_type = 'crew' AND item_id = 'police' AND quantity > 0
   ORDER BY acquired_at ASC LIMIT 1 FOR UPDATE;

  IF _police_row_id IS NOT NULL THEN
    SELECT id INTO _thief_row_id FROM public.inventory
     WHERE user_id = _me AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
     ORDER BY acquired_at ASC LIMIT 1 FOR UPDATE;

    IF _thief_row_id IS NOT NULL THEN
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _thief_row_id;
      DELETE FROM public.inventory WHERE id = _thief_row_id AND quantity <= 0;
      _bypass := (random() < 0.8);
    END IF;

    IF NOT _bypass THEN
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _police_row_id;
      DELETE FROM public.inventory WHERE id = _police_row_id AND quantity <= 0;
      UPDATE public.profiles SET steal_blocked_until = now() + interval '1 hour' WHERE id = _me;
      INSERT INTO public.notifications (recipient_id, title, body, kind)
      VALUES
        (_me, '👮 قبض عليك!', 'شرطي الخصم قبض عليك — ممنوع من السرقة ساعة', 'warning'),
        (_target_user_id, '👮 شرطيك قبض على لص!', 'شرطيك أمسك لصاً يحاول سرقتك', 'success');
      RAISE EXCEPTION 'caught by police';
    END IF;
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