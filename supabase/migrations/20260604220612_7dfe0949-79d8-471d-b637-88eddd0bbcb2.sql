CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
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
  _sailor_mult numeric := 1; _luck_mult integer := 1; _has_crew boolean := false;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
    RAISE EXCEPTION 'ship_destroyed';
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

  -- Sailor: +70% fishing speed (was 40%)
  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'sailor' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _sailor_mult := 1.7; END IF;
  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _luck_mult := 2; END IF;
  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _has_crew AND _requested_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32 THEN COALESCE(_ship.max_hp, _cat.storage, 10) ELSE COALESCE(_cat.storage, 10) END);

  _market_remaining := public.user_market_remaining(_uid);

  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);

  _base := FLOOR(_capacity * _ratio)::integer;
  IF _base <= 0 AND _elapsed >= 2 THEN
    _base := 1;
  END IF;
  _base := GREATEST(_base, 0);
  _base := LEAST(_base, _capacity);

  _qty := _base * _luck_mult;
  _qty := LEAST(_qty::bigint, _market_remaining)::int;
  IF _qty < 0 THEN _qty := 0; END IF;

  _xp := CASE WHEN _qty > 0 THEN LEAST(50 + COALESCE(_ship.template_id, 1) * 40, GREATEST(5, FLOOR(_qty * 0.4)::integer + COALESCE(_ship.template_id, 1) * 5)) ELSE 0 END;

  UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = now() WHERE so.id = _ship_id;

  IF _qty > 0 THEN
    INSERT INTO public.fish_stock(user_id, fish_id, quantity, source) VALUES (_uid, _chosen, _qty, 'fishing');
    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
    PERFORM public.increment_fish_caught(_chosen, _qty);
  END IF;

  fish_id := _chosen;
  fish_qty := _qty;
  base_qty := _base;
  luck_bonus := CASE WHEN _luck_mult > 1 THEN _qty - _base ELSE 0 END;
  xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer;
  duration_seconds := _duration;
  RETURN NEXT;
END $function$;