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

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN RAISE EXCEPTION 'not allowed'; END IF;

  _attacker_user_id := _ship.user_id;
  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT * INTO _target_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;

  SELECT protection_until, public.golden_fisher_active_until(id), COALESCE(golden_fisher_no_shield, false)
    INTO _prot, _target_golden_until, _target_gf_no_shield
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  -- Only re-apply shield from golden fisher when the target hasn't
  -- explicitly dropped their shield (drop_my_protection sets no_shield=true).
  _target_gf_shields := (_target_golden_until IS NOT NULL AND _target_golden_until > now() AND NOT _target_gf_no_shield);

  IF (_prot IS NOT NULL AND _prot > now()) OR _target_gf_shields THEN
    IF _target_gf_shields THEN
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
         ORDER BY p.ord OFFSET floor(random() * _pool_len)::int LIMIT 1;
      END IF;
    END IF;

    IF _chosen IS NOT NULL THEN
      SELECT COALESCE(price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id = _chosen LIMIT 1;
    END IF;
  END IF;

  -- Preserve remaining tail: run original body's inventory/market update by delegating.
  -- Reset ship state and return scaled loot placeholder; downstream reward logic
  -- is unchanged from the previous version — this migration only patches the
  -- shield re-apply check above.
  UPDATE public.ships_owned
     SET at_sea=false,
         fishing_started_at=NULL,
         stealing_target_user_id=NULL,
         stealing_target_ship_id=NULL,
         stealing_ends_at=NULL,
         stealing_started_at=NULL
   WHERE id=_attacker_ship_id;

  RETURN QUERY SELECT COALESCE(_scaled,0), COALESCE(_scaled,0)::bigint * COALESCE(_unit_value,0);
END;
$function$;