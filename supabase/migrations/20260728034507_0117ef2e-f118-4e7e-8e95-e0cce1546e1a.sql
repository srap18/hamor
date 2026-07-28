CREATE OR REPLACE FUNCTION public._steal_duration_seconds(
  _user uuid,
  _ship_id uuid,
  _cat public.ship_catalog,
  _started_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    1,
    CASE WHEN EXISTS (
      SELECT 1
      FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'thief'
        AND i.quantity > 0
        AND i.meta->>'assigned_ship_id' = _ship_id::text
        AND COALESCE(NULLIF(i.meta->>'assigned_at', '')::timestamptz, _started_at) <= _started_at
        AND COALESCE(NULLIF(i.meta->>'expires_at', '')::timestamptz, _started_at + interval '100 years') > _started_at
    )
    THEN CEIL(public._steal_seconds_for(_cat) / 2.0)::integer
    ELSE public._steal_seconds_for(_cat)
    END
  );
$$;

REVOKE ALL ON FUNCTION public._steal_duration_seconds(uuid, uuid, public.ship_catalog, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._steal_duration_seconds(uuid, uuid, public.ship_catalog, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public._effective_steal_elapsed(
  _user uuid,
  _ship_id uuid,
  _started_at timestamptz,
  _as_of timestamptz DEFAULT now()
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Raider acceleration is snapshotted into stealing_ends_at when the mission
  -- starts. Progress must therefore use wall-clock time exactly once, otherwise
  -- loot fills before the visible countdown finishes.
  SELECT GREATEST(0, EXTRACT(EPOCH FROM (_as_of - _started_at)))::numeric;
$$;

CREATE OR REPLACE FUNCTION public.start_steal_mission_impl(
  _attacker_ship_id uuid,
  _target_user_id uuid,
  _target_ship_id uuid
)
RETURNS TABLE(ends_at timestamptz)
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

  PERFORM pg_advisory_xact_lock(hashtextextended('steal_start:' || _attacker_ship_id::text, 0));

  SELECT * INTO _my_ship
  FROM public.ships_owned
  WHERE id = _attacker_ship_id AND user_id = _me
  FOR UPDATE;

  IF _my_ship.id IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;

  IF _my_ship.stealing_ends_at IS NOT NULL
     AND _my_ship.stealing_ends_at > now()
     AND _my_ship.stealing_target_user_id = _target_user_id
     AND _my_ship.stealing_target_ship_id = _target_ship_id THEN
    RETURN QUERY SELECT _my_ship.stealing_ends_at;
    RETURN;
  END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_target_user_id);

  _req_error := public.pvp_steal_requirement_error(_me, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  _req_error := public.pvp_steal_requirement_error(_target_user_id, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

  IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN
    RAISE EXCEPTION 'blocked: cannot steal from an account on the same device';
  END IF;

  UPDATE public.profiles
  SET protection_until = NULL
  WHERE id = _me AND protection_until IS NOT NULL;

  SELECT protection_until,
         public.golden_fisher_active_until(id),
         COALESCE(golden_fisher_no_shield, false)
  INTO _target_protection, _target_golden_until, _target_gf_no_shield
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  _target_gf_shields := (
    _target_golden_until IS NOT NULL
    AND _target_golden_until > now()
    AND NOT _target_gf_no_shield
  );

  IF (_target_protection IS NOT NULL AND _target_protection > now()) OR _target_gf_shields THEN
    IF _target_gf_shields THEN
      UPDATE public.profiles
      SET protection_until = GREATEST(
        COALESCE(protection_until, now()),
        COALESCE(_target_golden_until, protection_until, now())
      )
      WHERE id = _target_user_id;
    END IF;
    RAISE EXCEPTION 'target is shielded';
  END IF;

  IF _my_ship.in_storage THEN RAISE EXCEPTION 'attacker ship in storage'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'attacker ship destroyed'; END IF;
  IF COALESCE(_my_ship.hp, 0) <= 1 THEN RAISE EXCEPTION 'attacker ship destroyed (no HP)'; END IF;
  IF _my_ship.max_hp IS NOT NULL AND _my_ship.max_hp > 0
     AND _my_ship.hp::numeric / _my_ship.max_hp::numeric < 0.30 THEN
    RAISE EXCEPTION 'attacker ship destroyed (hp below 30%%) — repair first';
  END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'attacker ship busy'; END IF;
  IF _my_ship.stealing_ends_at IS NOT NULL AND _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'attacker ship already stealing';
  END IF;

  SELECT * INTO _their_ship
  FROM public.ships_owned
  WHERE id = _target_ship_id AND user_id = _target_user_id
  FOR UPDATE;

  IF _their_ship.id IS NULL THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'target ship not fishing';
  END IF;
  IF _their_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'target ship destroyed'; END IF;
  IF COALESCE(_their_ship.hp, 0) <= 1 THEN RAISE EXCEPTION 'target ship destroyed (no HP)'; END IF;

  SELECT stealing_target_user_id INTO _existing_raider
  FROM public.ships_owned
  WHERE stealing_target_ship_id = _target_ship_id
    AND stealing_ends_at IS NOT NULL
    AND stealing_ends_at > now()
    AND user_id <> _me
  LIMIT 1;

  IF _existing_raider IS NOT NULL THEN
    RAISE EXCEPTION 'target already being raided';
  END IF;

  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = _my_ship.catalog_code AND active = true
    LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true
    LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE sort_order = COALESCE(_my_ship.template_id, 1) AND active = true
    ORDER BY market_level_required ASC
    LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN RAISE EXCEPTION 'attacker ship catalog not found'; END IF;

  _secs := public._steal_duration_seconds(_me, _attacker_ship_id, _cat, _started);
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
  SET stealing_target_user_id = _target_user_id,
      stealing_target_ship_id = _target_ship_id,
      stealing_started_at = _started,
      stealing_ends_at = _ends
  WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _ends;
END;
$function$;