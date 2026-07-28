
-- 1) Steal-only elapsed helper: like fishing's sailor bonus, but bound to
-- the "thief" (raider) crew. Never reads the sailor crew.
CREATE OR REPLACE FUNCTION public._effective_steal_elapsed(
  _user uuid, _ship_id uuid, _started_at timestamptz, _as_of timestamptz DEFAULT now()
)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT GREATEST(0, EXTRACT(EPOCH FROM (_as_of - _started_at)))::numeric AS elapsed
  ), raider AS (
    SELECT
      NULLIF(i.meta->>'assigned_at', '')::timestamptz AS assigned_at,
      COALESCE(NULLIF(i.meta->>'expires_at', '')::timestamptz, _as_of) AS expires_at
    FROM public.inventory i
    WHERE i.user_id = _user
      AND i.item_type = 'crew'
      AND i.item_id = 'thief'
      AND i.meta->>'assigned_ship_id' = _ship_id::text
      AND COALESCE(NULLIF(i.meta->>'expires_at', '')::timestamptz, _as_of) > _started_at
      AND COALESCE(NULLIF(i.meta->>'assigned_at', '')::timestamptz, _started_at) <= _as_of
  ), bonus AS (
    SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(_as_of, expires_at) - GREATEST(_started_at, COALESCE(assigned_at, _started_at))
    )))), 0)::numeric AS extra
    FROM raider
    WHERE LEAST(_as_of, expires_at) > GREATEST(_started_at, COALESCE(assigned_at, _started_at))
  )
  SELECT base.elapsed + bonus.extra FROM base, bonus;
$$;

-- 2) Replace sailor bonus with raider bonus inside claim_steal_mission.
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
    -- RAIDER (thief) crew only. Sailor has NO effect on steal.
    _elapsed := public._effective_steal_elapsed(_me, _attacker_ship_id, _start, LEAST(now(), _ship.stealing_ends_at))
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
  IF _target_cap > 0 THEN _max := LEAST(_my_cap, _target_cap); ELSE _max := _my_cap; END IF;
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

-- 3) Same fix in cancel_steal_mission.
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
  IF NOT FOUND THEN RETURN QUERY SELECT 0, 0::bigint; RETURN; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RETURN QUERY SELECT 0, 0::bigint; RETURN; END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN RAISE EXCEPTION 'not allowed'; END IF;

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
    -- RAIDER (thief) crew only. Sailor bonus does NOT apply to steal.
    _elapsed := public._effective_steal_elapsed(_attacker_user_id, _attacker_ship_id, _start, LEAST(now(), _ship.stealing_ends_at))
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
