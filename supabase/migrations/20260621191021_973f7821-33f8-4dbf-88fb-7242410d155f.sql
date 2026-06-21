CREATE OR REPLACE FUNCTION public.golden_fisher_active_until(_user uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    COALESCE((SELECT p.golden_fisher_until FROM public.profiles p WHERE p.id = _user), '-infinity'::timestamptz),
    COALESCE((
      SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
      FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at'
    ), '-infinity'::timestamptz)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.golden_fisher_active_until(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.golden_fisher_active_until(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.golden_fisher_active_until(uuid) TO service_role;

UPDATE public.profiles p
   SET protection_until = GREATEST(
         COALESCE(p.protection_until, now()),
         public.golden_fisher_active_until(p.id)
       ),
       golden_fisher_until = GREATEST(
         COALESCE(p.golden_fisher_until, '-infinity'::timestamptz),
         public.golden_fisher_active_until(p.id)
       )
 WHERE public.golden_fisher_active_until(p.id) > now();

UPDATE public.ships_owned s
   SET at_sea = false,
       fishing_started_at = NULL,
       stealing_target_user_id = NULL,
       stealing_target_ship_id = NULL,
       stealing_ends_at = NULL,
       stealing_started_at = NULL
 WHERE s.stealing_target_user_id IN (
   SELECT p.id FROM public.profiles p
   WHERE public.golden_fisher_active_until(p.id) > now()
      OR (p.protection_until IS NOT NULL AND p.protection_until > now())
 );

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
  _base timestamptz;
  _had_inventory boolean := false;
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row
  FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
    AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    AND quantity > 0
  ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NOT NULL THEN
    _had_inventory := true;
    IF _row.quantity <= 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;
    _base := GREATEST(COALESCE(_current, now()), now());
    _new_until := _base + interval '24 hours';
  ELSE
    IF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    END IF;
    _new_until := _current;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
   WHERE id = _uid;

  -- Cancel any already-started incoming steal missions as soon as Golden Fisher is active.
  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

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

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', (_current IS NOT NULL AND _current > now() AND NOT _had_inventory),
    'extended', _had_inventory,
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _capacity int;
  _market_remaining bigint;
  _qty bigint;
  _unit_value bigint;
  _cycles int := 0;
  _ships_processed int := 0;
  _now timestamptz := now();
  _elapsed numeric;
  _effective_elapsed numeric;
  _duration int;
  _active_until timestamptz;
  _luck_mult int;
  _has_sailor boolean;
  _sailor_assigned_at timestamptz;
  _has_guide boolean;
  _preferred text;
  _ship_preferred text;
  _n_cycles int;
  _consumed_cycles int;
BEGIN
  SELECT public.golden_fisher_active_until(_user) INTO _active_until;

  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = GREATEST(COALESCE(golden_fisher_until, '-infinity'::timestamptz), _active_until),
         protection_until = GREATEST(COALESCE(protection_until, _active_until), _active_until)
   WHERE id = _user;

  -- Clear any incoming steal missions that slipped in before the shield was synced.
  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _user;

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = COALESCE(fishing_started_at, _now)
   WHERE user_id = _user
     AND in_storage = false
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND (at_sea = false OR fishing_started_at IS NULL);

  FOR _ship IN
    SELECT * FROM public.ships_owned
    WHERE user_id = _user AND in_storage = false AND destroyed_at IS NULL
      AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
      AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
      AND at_sea = true
      AND fishing_started_at IS NOT NULL
    FOR UPDATE
  LOOP
    _cat := NULL;

    IF _ship.catalog_code IS NOT NULL THEN
      SELECT * INTO _cat FROM public.ship_catalog
      WHERE code = _ship.catalog_code AND active = true LIMIT 1;
    END IF;
    IF _cat.id IS NULL THEN
      SELECT * INTO _cat FROM public.ship_catalog
      WHERE sort_order = COALESCE(_ship.template_id, 1) AND active = true
      ORDER BY market_level_required ASC LIMIT 1;
    END IF;

    IF _cat.id IS NULL THEN CONTINUE; END IF;

    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
    IF _pool_len = 0 THEN CONTINUE; END IF;

    _has_sailor := false;
    _sailor_assigned_at := NULL;
    SELECT true, NULLIF(i.meta->>'assigned_at','')::timestamptz INTO _has_sailor, _sailor_assigned_at
    FROM public.inventory i
    WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'sailor'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;
    _has_sailor := COALESCE(_has_sailor, false);

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at)));
    _effective_elapsed := _elapsed;
    IF _has_sailor THEN
      IF _sailor_assigned_at IS NULL OR _sailor_assigned_at <= _ship.fishing_started_at THEN
        _effective_elapsed := _elapsed * 2;
      ELSE
        _effective_elapsed := _elapsed + GREATEST(0, EXTRACT(EPOCH FROM (_now - _sailor_assigned_at)));
      END IF;
    END IF;

    _n_cycles := FLOOR(_effective_elapsed / (_duration::numeric * 0.99))::int;

    IF _n_cycles < 1 THEN
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _capacity := GREATEST(1, CASE
      WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
        THEN COALESCE(_ship.max_hp, _cat.storage, 10)
      ELSE COALESCE(_cat.storage, 10)
    END);

    _luck_mult := 1;
    IF EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'luck'
        AND (i.meta->>'assigned_ship_id') = _ship.id::text
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    ) THEN _luck_mult := 2; END IF;

    _has_guide := false; _preferred := NULL;
    SELECT true, (i.meta->>'preferred_fish_id') INTO _has_guide, _preferred
    FROM public.inventory i
    WHERE i.user_id = _user AND i.item_type = 'crew' AND i.item_id = 'guide'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;

    _ship_preferred := _ship.preferred_fish_id;
    IF _ship_preferred IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_preferred) THEN
      _chosen := _ship_preferred;
    ELSIF _has_guide AND _preferred IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _preferred) THEN
      _chosen := _preferred;
    ELSE
      _chosen := _pool->>floor(random() * _pool_len)::int;
    END IF;

    _market_remaining := public.user_market_remaining(_user);
    _consumed_cycles := 0;

    IF _market_remaining > 0 THEN
      _qty := LEAST((_capacity::bigint * _luck_mult::bigint * _n_cycles::bigint), _market_remaining);
      _consumed_cycles := LEAST(
        _n_cycles,
        GREATEST(1, CEIL(_qty::numeric / GREATEST(1, (_capacity * _luck_mult)::numeric))::int)
      );

      IF _qty > 0 THEN
        INSERT INTO public.fish_caught (user_id, fish_id, quantity, total_caught, updated_at)
        VALUES (_user, _chosen, _qty::int, _qty::int, _now)
        ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
          SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
              total_caught = public.fish_caught.total_caught + EXCLUDED.quantity,
              updated_at = _now;

        SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
        FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen;

        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_user, _chosen, _ship.id, _now, COALESCE(_unit_value, 0), _qty::int);

        _cycles := _cycles + _consumed_cycles;
      END IF;
    END IF;

    IF _consumed_cycles > 0 THEN
      UPDATE public.ships_owned
         SET fishing_started_at = _now - make_interval(secs => GREATEST(0, FLOOR((_effective_elapsed - (_consumed_cycles * _duration)) / CASE WHEN _has_sailor THEN 2 ELSE 1 END))::int),
             last_fishing_reward_at = _now
       WHERE id = _ship.id;
    END IF;

    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END;
$function$;

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
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF public.is_admin(_target_user_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;
  IF NOT public.is_market_pvp_unlocked(_me) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_me) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF NOT public.is_market_pvp_unlocked(_target_user_id) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN
    RAISE EXCEPTION 'blocked: cannot steal from an account on the same device';
  END IF;

  -- Lock the defender profile so activation of Golden Fisher and steal start cannot race each other.
  SELECT protection_until, public.golden_fisher_active_until(id)
    INTO _target_protection, _target_golden_until
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  IF (_target_protection IS NOT NULL AND _target_protection > now())
     OR (_target_golden_until IS NOT NULL AND _target_golden_until > now()) THEN
    UPDATE public.profiles
       SET golden_fisher_until = GREATEST(COALESCE(golden_fisher_until, '-infinity'::timestamptz), COALESCE(_target_golden_until, '-infinity'::timestamptz)),
           protection_until = GREATEST(COALESCE(protection_until, now()), COALESCE(_target_golden_until, protection_until, now()))
     WHERE id = _target_user_id
       AND _target_golden_until IS NOT NULL
       AND _target_golden_until > now();
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

  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _my_ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_my_ship.template_id, 1) AND active = true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  _secs := GREATEST(30, ROUND(COALESCE(_cat.fishing_seconds, 60) * 0.6)::int);
  _ends := now() + (_secs || ' seconds')::interval;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = now()
   WHERE id = _their_ship.id;

  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends,
         stealing_started_at = _started
   WHERE id = _my_ship.id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _me;
  PERFORM public.notify_steal_started(_target_user_id, _me, _attacker_name, _attacker_emoji);

  RETURN QUERY SELECT _ends;
END;
$function$;

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
  _grace_seconds constant numeric := 3;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN RAISE EXCEPTION 'not allowed'; END IF;

  _attacker_user_id := _ship.user_id;
  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT * INTO _target_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;

  SELECT protection_until, public.golden_fisher_active_until(id)
    INTO _prot, _target_golden_until
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  IF (_prot IS NOT NULL AND _prot > now())
     OR (_target_golden_until IS NOT NULL AND _target_golden_until > now()) THEN
    IF _target_golden_until IS NOT NULL AND _target_golden_until > now() THEN
      UPDATE public.profiles
         SET golden_fisher_until = GREATEST(COALESCE(golden_fisher_until, '-infinity'::timestamptz), _target_golden_until),
             protection_until = GREATEST(COALESCE(protection_until, _target_golden_until), _target_golden_until)
       WHERE id = _target_user_id;
    END IF;

    UPDATE public.ships_owned
       SET at_sea=false,
           fishing_started_at=NULL,
           stealing_target_user_id=NULL,
           stealing_target_ship_id=NULL,
           stealing_ends_at=NULL,
           stealing_started_at=NULL
     WHERE id=_attacker_ship_id;

    RETURN QUERY SELECT 0, 0::bigint; RETURN;
  END IF;

  _start := COALESCE(_ship.stealing_started_at, _ship.fishing_started_at, now());
  IF _ship.stealing_ends_at IS NOT NULL THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _start)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _start))) + _grace_seconds;
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

  _max := GREATEST(1, COALESCE(_cat.fishing_power, _cat.storage, 10));
  _market_remaining := public.user_market_remaining(_attacker_user_id);

  _scaled := FLOOR(_max * _ratio)::int;
  IF _ratio > 0 AND _scaled < 1 THEN _scaled := 1; END IF;
  _scaled := LEAST(GREATEST(0,_scaled)::bigint, _market_remaining)::int;

  IF _scaled > 0 AND _target_ship.id IS NOT NULL THEN
    IF _target_ship.catalog_code IS NOT NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code = _target_ship.catalog_code AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_target_ship.template_id,1)) AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE sort_order = COALESCE(_target_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
    END IF;

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

      SELECT COALESCE(current_price,0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id = _chosen;
      IF _unit_value IS NULL THEN _unit_value := 0; END IF;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_attacker_user_id, _chosen, _attacker_ship_id, now(), _unit_value, _scaled);
      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_attacker_user_id, _chosen, _scaled, _scaled, now())
      ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
          updated_at = now();
      INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_attacker_user_id, _chosen, now(), _scaled);
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

GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO authenticated;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO service_role;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.activate_golden_fisher() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) FROM anon, public;