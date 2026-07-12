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
  _cat public.ship_catalog%ROWTYPE;
  _secs integer;
  _ends timestamptz;
  _started timestamptz := now();
  _attacker_name text;
  _attacker_emoji text;
  _target_protection timestamptz;
  _target_golden_until timestamptz;
  _target_gf_no_shield boolean;
  _target_gf_shields boolean;
  _req_error text;
  _existing_raider uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF public.is_admin(_target_user_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_target_user_id);

  _req_error := public.pvp_requirement_error(_me, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  _req_error := public.pvp_requirement_error(_target_user_id, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

  IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN
    RAISE EXCEPTION 'blocked: cannot steal from an account on the same device';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _me AND protection_until IS NOT NULL;

  SELECT protection_until, public.golden_fisher_active_until(id), COALESCE(golden_fisher_no_shield, false)
    INTO _target_protection, _target_golden_until, _target_gf_no_shield
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  _target_gf_shields := (_target_golden_until IS NOT NULL AND _target_golden_until > now() AND NOT _target_gf_no_shield);

  IF (_target_protection IS NOT NULL AND _target_protection > now()) OR _target_gf_shields THEN
    IF _target_gf_shields THEN
      UPDATE public.profiles
         SET protection_until = GREATEST(COALESCE(protection_until, now()), COALESCE(_target_golden_until, protection_until, now()))
       WHERE id = _target_user_id;
    END IF;
    RAISE EXCEPTION 'target is shielded';
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my_ship.id IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.in_storage THEN RAISE EXCEPTION 'attacker ship in storage'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'attacker ship destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'attacker ship busy'; END IF;
  IF _my_ship.stealing_ends_at IS NOT NULL AND _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'attacker ship already stealing';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;
  IF _their_ship.id IS NULL THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'target ship not fishing';
  END IF;

  -- Only ONE raider allowed per target ship at a time. Reject if another
  -- ship is already stealing from this exact target ship.
  SELECT id INTO _existing_raider
    FROM public.ships_owned
   WHERE stealing_target_ship_id = _target_ship_id
     AND stealing_ends_at IS NOT NULL
     AND stealing_ends_at > now()
     AND id <> _attacker_ship_id
   LIMIT 1;
  IF _existing_raider IS NOT NULL THEN
    RAISE EXCEPTION 'target ship is already being raided by another pirate';
  END IF;

  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _my_ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_my_ship.template_id, 1) AND active = true LIMIT 1;
  END IF;

  _secs := GREATEST(60, COALESCE(_cat.fishing_seconds, 300));
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_started_at = _started,
         stealing_ends_at = _ends,
         at_sea = true,
         fishing_started_at = _started
   WHERE id = _attacker_ship_id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji
    FROM public.profiles WHERE id = _me;

  INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_target_user_id, 'steal_incoming',
            'محاولة سرقة!',
            COALESCE(_attacker_name, 'قرصان') || ' يحاول سرقة أسماك سفينتك',
            _me,
            jsonb_build_object(
              'attacker_id', _me,
              'attacker_name', _attacker_name,
              'attacker_emoji', _attacker_emoji,
              'target_ship_id', _target_ship_id,
              'ends_at', _ends
            ));

  RETURN QUERY SELECT _ends;
END
$function$;