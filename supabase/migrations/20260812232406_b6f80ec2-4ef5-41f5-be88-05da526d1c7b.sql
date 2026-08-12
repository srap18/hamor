DROP FUNCTION IF EXISTS public.collect_fishing_reward(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text, _client_progress integer DEFAULT NULL::integer)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer, gems_awarded integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record; _cat record; _pool jsonb; _pool_len integer; _chosen text;
  _capacity integer;
  _market_remaining bigint;
  _duration integer; _elapsed numeric; _ratio numeric;
  _luck_mult integer := 1; _has_crew boolean := false;
  _has_guide boolean := false; _guide_pref text; _owns_guide boolean := false;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _gems integer := 0;
  _grace_seconds constant numeric := 5;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.max_hp IS NOT NULL AND _ship.max_hp > 0 AND _ship.hp IS NOT NULL THEN
    _hp_ratio := _ship.hp::numeric / _ship.max_hp::numeric;
    IF _hp_ratio < 0.30 THEN
      UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
    _hp_ratio := GREATEST(0.05, LEAST(1.0, _hp_ratio));
  END IF;

  IF _ship.fishing_started_at IS NULL THEN RAISE EXCEPTION 'not_fishing'; END IF;
  IF NOT COALESCE(_ship.at_sea, false) THEN
    UPDATE public.ships_owned so SET at_sea = true WHERE so.id = _ship_id;
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = _ship.catalog_code AND sc.active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND sc.active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.sort_order = COALESCE(_ship.template_id, 1) AND sc.active = true ORDER BY sc.market_level_required ASC LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN RAISE EXCEPTION 'ship_catalog_missing'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _luck_mult := 2; END IF;

  _has_guide := false; _guide_pref := NULL;
  SELECT true, NULLIF(inv.meta->>'preferred_fish_id','')
    INTO _has_guide, _guide_pref
  FROM public.inventory inv
  WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
    AND inv.meta->>'assigned_ship_id' = _ship_id::text
    AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  LIMIT 1;
  _has_guide := COALESCE(_has_guide, false);

  SELECT EXISTS (SELECT 1 FROM public.inventory inv
                  WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
                    AND inv.quantity > 0
                    AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now()))
    INTO _owns_guide;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _owns_guide AND _requested_fish_id IS NOT NULL AND _requested_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSIF _has_guide AND _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id) THEN
    _chosen := _ship.preferred_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub', 'royal-whale') OR COALESCE(_ship.template_id, 0) IN (32, 33, 37)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

  _market_remaining := public.user_market_remaining(_uid);
  IF _market_remaining <= 0 THEN RAISE EXCEPTION 'market_full'; END IF;

  _elapsed := public._effective_fishing_elapsed(_uid, _ship_id, _ship.fishing_started_at, now()) + _grace_seconds;
  _ratio := LEAST(1, _elapsed / _duration);

  _base := ROUND(_capacity * _ratio)::integer;
  IF _base <= 0 THEN _base := 1; END IF;
  _base := LEAST(_base, _capacity);

  _qty := _base * _luck_mult;
  _qty := LEAST(_qty::bigint, _market_remaining)::int;
  IF _qty < 1 THEN _qty := 1; END IF;

  _xp := 0;

  UPDATE public.ships_owned so
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = now()
   WHERE so.id = _ship_id;

  IF _qty > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _chosen, _qty, _qty)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key
    DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
                  total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
                  updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
      FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen LIMIT 1;
    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _chosen, _ship_id, now(), COALESCE(_unit_value, 0), _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, qty, source)
    SELECT _uid, _chosen, _qty, 'catch'
    WHERE EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.active = true
        AND c.metric IN ('fish_specific', 'fish_total')
        AND (c.metric = 'fish_total' OR c.target_fish_id = _chosen)
        AND now() BETWEEN c.starts_at AND c.ends_at
    );
  END IF;

  -- Royal Purple Whale: 1-3 random gems, ONLY on a fully completed (full) trip.
  IF COALESCE(_ship.catalog_code, '') = 'royal-whale' AND _ratio >= 1 THEN
    _gems := 1 + floor(random() * 3)::int;
    PERFORM set_config('app.audit_source', 'royal_whale_full_catch', true);
    PERFORM set_config('app.audit_reason', 'مكافأة امتلاء الحوت الأرجواني', true);
    PERFORM public._mutate_currency(_uid, 0, _gems, 0, 0);
  END IF;

  RETURN QUERY SELECT _chosen, _qty, _base, GREATEST(0, _qty - _base), _xp,
                      FLOOR(LEAST(_elapsed, _duration))::int, _duration, _gems;
END
$function$;

REVOKE ALL ON FUNCTION public.collect_fishing_reward(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public._ship_pending_catch(_owner uuid, _ship_id uuid)
RETURNS TABLE(fish_id text, qty bigint, capacity bigint, duration int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _pool jsonb; _pool_len int; _chosen text;
  _cap bigint; _dur int; _elapsed numeric; _ratio numeric; _hp_ratio numeric := 1;
  _has_guide boolean := false; _guide_pref text;
BEGIN
  SELECT * INTO _ship FROM public.ships_owned WHERE id = _ship_id AND user_id = _owner;
  IF _ship.id IS NULL OR _ship.fishing_started_at IS NULL THEN
    RETURN QUERY SELECT NULL::text, 0::bigint, 0::bigint, 0; RETURN;
  END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code AND active = true LIMIT 1;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog
     WHERE code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    RETURN QUERY SELECT NULL::text, 0::bigint, 0::bigint, 0; RETURN;
  END IF;

  IF COALESCE(_ship.max_hp,0) > 0 AND _ship.hp IS NOT NULL THEN
    _hp_ratio := GREATEST(0.05, LEAST(1.0, _ship.hp::numeric / _ship.max_hp::numeric));
  END IF;

  _cap := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code,'') IN ('submarine','upgrade-sub','royal-whale') OR COALESCE(_ship.template_id,0) IN (32,33,37)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _cap := GREATEST(1, FLOOR(_cap * _hp_ratio)::bigint);

  _dur := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _elapsed := public._effective_fishing_elapsed(_owner, _ship_id, _ship.fishing_started_at, now());
  _ratio := LEAST(1, GREATEST(0, _elapsed / _dur));

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN
    RETURN QUERY SELECT NULL::text, 0::bigint, _cap, _dur; RETURN;
  END IF;

  SELECT true, NULLIF(i.meta->>'preferred_fish_id','')
    INTO _has_guide, _guide_pref
  FROM public.inventory i
  WHERE i.user_id = _owner AND i.item_type = 'crew' AND i.item_id = 'guide'
    AND i.meta->>'assigned_ship_id' = _ship_id::text
    AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())
  LIMIT 1;
  _has_guide := COALESCE(_has_guide, false);

  IF _has_guide AND _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id) THEN
    _chosen := _ship.preferred_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
     WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len))
     LIMIT 1;
  END IF;

  RETURN QUERY SELECT _chosen, GREATEST(0, FLOOR(_cap * _ratio)::bigint), _cap, _dur;
END;
$$;