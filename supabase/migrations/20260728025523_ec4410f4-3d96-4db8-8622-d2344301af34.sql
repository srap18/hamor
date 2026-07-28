
-- 1) Server-side duration derived from the ship's SPEED (same catalog the
-- fishing system reads), so faster ships steal faster and slower ships
-- take longer. Range clamped to 30..300s to stay playable.
CREATE OR REPLACE FUNCTION public._steal_seconds_for(_cat public.ship_catalog)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT GREATEST(30, LEAST(300,
    ROUND(1800.0 / GREATEST(1, COALESCE(_cat.speed, 10)))
  ))::int;
$$;

-- 2) Rewrite start_steal_mission_impl:
--    * duration from ship speed (server-side, ignores any client value)
--    * advisory lock on attacker ship id to serialize rapid-tap starts
--    * idempotent when the same ship already has an active mission on the
--      same target: returns the existing ends_at instead of a second run
--    * HP is never touched here (documented) — steal is HP-neutral
CREATE OR REPLACE FUNCTION public.start_steal_mission_impl(
  _attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid
)
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

  -- Serialize concurrent start calls on the same attacker ship
  -- (rapid button taps / duplicate in-flight requests).
  PERFORM pg_advisory_xact_lock(hashtextextended('steal_start:' || _attacker_ship_id::text, 0));

  -- Idempotency: if this ship already has an active mission on the same
  -- target, return the existing ends_at silently (no second mission, no
  -- double state change).
  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my_ship.id IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.stealing_ends_at IS NOT NULL
     AND _my_ship.stealing_ends_at > now()
     AND _my_ship.stealing_target_user_id = _target_user_id
     AND _my_ship.stealing_target_ship_id = _target_ship_id THEN
    RETURN QUERY SELECT _my_ship.stealing_ends_at; RETURN;
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

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _me AND protection_until IS NOT NULL;

  SELECT protection_until, public.golden_fisher_active_until(id), COALESCE(golden_fisher_no_shield, false)
    INTO _target_protection, _target_golden_until, _target_gf_no_shield
  FROM public.profiles WHERE id = _target_user_id FOR UPDATE;

  _target_gf_shields := (_target_golden_until IS NOT NULL AND _target_golden_until > now() AND NOT _target_gf_no_shield);

  IF (_target_protection IS NOT NULL AND _target_protection > now()) OR _target_gf_shields THEN
    IF _target_gf_shields THEN
      UPDATE public.profiles
         SET protection_until = GREATEST(COALESCE(protection_until, now()), COALESCE(_target_golden_until, protection_until, now()))
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

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;
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

  -- Resolve attacker catalog (speed source).
  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code=_my_ship.catalog_code AND active=true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code=('ship-lvl-' || COALESCE(_my_ship.template_id,1)) AND active=true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_my_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  -- Server-side duration from ship SPEED. Any value the client sends is ignored.
  _secs := public._steal_seconds_for(_cat);
  _ends := _started + make_interval(secs => _secs);

  -- NOTE: steal missions never modify HP on either side. HP changes only
  -- through apply_ship_damage/boss_hit_my_ship. The idempotency guard above
  -- also prevents any double-state-change from rapid taps.
  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_started_at = _started,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _ends;
END;
$function$;

-- 3) Update claim_steal_mission: use _effective_fishing_elapsed so the
-- sailor crew bonus applies to steal progress the same way it does for
-- fishing. All time math continues to use server now().
CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
 RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _target_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _target_cat public.ship_catalog%ROWTYPE;
  _target_ship_id uuid;
  _target_user_id uuid;
  _start timestamptz;
  _duration numeric;
  _elapsed numeric;
  _ratio numeric := 1;
  _my_cap integer;
  _target_cap integer;
  _max integer;
  _market_remaining bigint;
  _scaled integer := 0;
  _pool jsonb;
  _pool_len integer;
  _chosen text;
  _unit_value bigint := 0;
  _summary jsonb := '[]'::jsonb;
  _grace_seconds constant numeric := 3;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Serialize concurrent claim/cancel/start for this ship.
  PERFORM pg_advisory_xact_lock(hashtextextended('steal_start:' || _attacker_ship_id::text, 0));

  SELECT * INTO _ship FROM public.ships_owned WHERE id=_attacker_ship_id AND user_id=_me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF NOT _force AND (_ship.stealing_ends_at IS NULL OR _ship.stealing_ends_at > now()) THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT * INTO _target_ship FROM public.ships_owned WHERE id=_target_ship_id AND user_id=_target_user_id FOR UPDATE;

  _start := COALESCE(_ship.stealing_started_at, _ship.fishing_started_at, now());
  IF _force AND _ship.stealing_ends_at IS NOT NULL AND _ship.stealing_ends_at > now() THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _start)));
    -- Apply the same sailor-crew bonus that fishing uses.
    _elapsed := public._effective_fishing_elapsed(_me, _attacker_ship_id, _start, LEAST(now(), _ship.stealing_ends_at))
                + _grace_seconds;
    _ratio := LEAST(1, GREATEST(0, _elapsed / _duration));
  ELSE
    _ratio := 1;
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code=_ship.catalog_code AND active=true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code=('ship-lvl-' || COALESCE(_ship.template_id,1)) AND active=true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  IF _target_ship.id IS NOT NULL THEN
    IF _target_ship.catalog_code IS NOT NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code=_target_ship.catalog_code AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code=('ship-lvl-' || COALESCE(_target_ship.template_id,1)) AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE sort_order = COALESCE(_target_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
    END IF;
  END IF;

  _my_cap := GREATEST(1, COALESCE(_cat.fishing_power, _cat.storage, 10));
  _target_cap := GREATEST(0, COALESCE(_target_cat.fishing_power, _target_cat.storage, 0));
  IF _target_cap > 0 THEN
    _max := LEAST(_my_cap, _target_cap);
  ELSE
    _max := _my_cap;
  END IF;
  _market_remaining := public.user_market_remaining(_me);

  _scaled := FLOOR(_max * _ratio)::int;
  IF _ratio > 0 AND _scaled < 1 THEN _scaled := 1; END IF;
  _scaled := LEAST(GREATEST(0,_scaled)::bigint, _market_remaining)::int;

  IF _scaled > 0 AND _target_ship.id IS NOT NULL THEN
    _pool := COALESCE(_target_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);

    IF _pool_len > 0 THEN
      IF _target_ship.preferred_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _target_ship.preferred_fish_id) THEN
        _chosen := _target_ship.preferred_fish_id;
      ELSE
        SELECT p.value INTO _chosen
        FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
        WHERE p.ord = (1 + (abs(hashtextextended(_attacker_ship_id::text || ':' || _start::text, 91003)) % _pool_len))
        LIMIT 1;
      END IF;

      SELECT COALESCE(current_price,0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id=_chosen;
      IF _unit_value IS NULL THEN _unit_value := 0; END IF;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_me, _chosen, _attacker_ship_id, now(), _unit_value, _scaled);
      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_me, _chosen, _scaled, _scaled, now())
      ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
          updated_at = now();

      _summary := jsonb_build_array(jsonb_build_object('fish_id', _chosen, 'value', _unit_value, 'qty', _scaled));
    ELSE
      _scaled := 0;
    END IF;
  ELSE
    _scaled := 0;
  END IF;

  UPDATE public.ships_owned
     SET at_sea=false, fishing_started_at=NULL,
         stealing_target_user_id=NULL, stealing_target_ship_id=NULL,
         stealing_ends_at=NULL, stealing_started_at=NULL
   WHERE id=_attacker_ship_id;

  RETURN QUERY SELECT _scaled, (_scaled::bigint * _unit_value), _summary;
END;
$function$;

-- 4) Update cancel_steal_mission: same advisory lock + sailor-bonus elapsed.
CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _target_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _target_cat public.ship_catalog%ROWTYPE;
  _attacker_user_id uuid;
  _target_ship_id uuid;
  _target_user_id uuid;
  _start timestamptz;
  _duration numeric;
  _elapsed numeric;
  _ratio numeric := 0;
  _max integer;
  _market_remaining bigint;
  _scaled integer := 0;
  _pool jsonb;
  _pool_len integer;
  _chosen text;
  _unit_value bigint := 0;
  _prot timestamptz;
  _target_golden_until timestamptz;
  _target_gf_no_shield boolean;
  _target_gf_shields boolean;
  _grace_seconds constant numeric := 3;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('steal_start:' || _attacker_ship_id::text, 0));

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0::bigint; RETURN;
  END IF;
  IF _ship.stealing_target_user_id IS NULL THEN
    RETURN QUERY SELECT 0, 0::bigint; RETURN;
  END IF;

  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  _attacker_user_id := _ship.user_id;
  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  IF _target_ship_id IS NOT NULL THEN
    SELECT * INTO _target_ship FROM public.ships_owned
     WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;
  END IF;

  SELECT protection_until, public.golden_fisher_active_until(id), COALESCE(golden_fisher_no_shield, false)
    INTO _prot, _target_golden_until, _target_gf_no_shield
  FROM public.profiles WHERE id = _target_user_id FOR UPDATE;

  _target_gf_shields := (_target_golden_until IS NOT NULL AND _target_golden_until > now() AND NOT _target_gf_no_shield);

  IF (_prot IS NOT NULL AND _prot > now()) OR _target_gf_shields THEN
    UPDATE public.ships_owned
       SET at_sea=false, fishing_started_at=NULL,
           stealing_target_user_id=NULL, stealing_target_ship_id=NULL,
           stealing_ends_at=NULL, stealing_started_at=NULL
     WHERE id=_attacker_ship_id;
    RETURN QUERY SELECT 0, 0::bigint; RETURN;
  END IF;

  _start := COALESCE(_ship.stealing_started_at, _ship.fishing_started_at, now());
  IF _ship.stealing_ends_at IS NOT NULL THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _start)));
    _elapsed := public._effective_fishing_elapsed(_attacker_user_id, _attacker_ship_id, _start, LEAST(now(), _ship.stealing_ends_at))
                + _grace_seconds;
    _ratio := LEAST(1, GREATEST(0, _elapsed / _duration));
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_ship.template_id,1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  IF _target_ship.id IS NOT NULL THEN
    IF _target_ship.catalog_code IS NOT NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code=_target_ship.catalog_code AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code=('ship-lvl-' || COALESCE(_target_ship.template_id,1)) AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE sort_order = COALESCE(_target_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
    END IF;
  END IF;

  _max := GREATEST(1, LEAST(
    COALESCE(_cat.fishing_power, _cat.storage, 10),
    COALESCE(NULLIF(_target_cat.fishing_power, 0), _target_cat.storage, COALESCE(_cat.fishing_power, 10))
  ));
  _market_remaining := public.user_market_remaining(_attacker_user_id);

  _scaled := FLOOR(_max * _ratio)::int;
  IF _ratio > 0 AND _scaled < 1 THEN _scaled := 1; END IF;
  _scaled := LEAST(GREATEST(0,_scaled)::bigint, GREATEST(0,_market_remaining))::int;

  IF _scaled > 0 AND _target_ship.id IS NOT NULL THEN
    _pool := COALESCE(_target_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len > 0 THEN
      IF _target_ship.preferred_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _target_ship.preferred_fish_id) THEN
        _chosen := _target_ship.preferred_fish_id;
      ELSE
        SELECT p.value INTO _chosen
        FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
        WHERE p.ord = (1 + (abs(hashtextextended(_attacker_ship_id::text || ':' || _start::text, 91003)) % _pool_len))
        LIMIT 1;
      END IF;

      SELECT COALESCE(current_price,0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id=_chosen;
      IF _unit_value IS NULL THEN _unit_value := 0; END IF;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_attacker_user_id, _chosen, _attacker_ship_id, now(), _unit_value, _scaled);
      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_attacker_user_id, _chosen, _scaled, _scaled, now())
      ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
          updated_at = now();
    ELSE
      _scaled := 0;
    END IF;
  ELSE
    _scaled := 0;
  END IF;

  UPDATE public.ships_owned
     SET at_sea=false, fishing_started_at=NULL,
         stealing_target_user_id=NULL, stealing_target_ship_id=NULL,
         stealing_ends_at=NULL, stealing_started_at=NULL
   WHERE id=_attacker_ship_id;

  RETURN QUERY SELECT _scaled, (_scaled::bigint * _unit_value);
END;
$function$;
