-- 1) Restore competition logging inside collect_fishing_reward
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text, _client_progress integer DEFAULT NULL::integer)
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
  _luck_mult integer := 1; _has_crew boolean := false;
  _has_guide boolean := false; _guide_pref text; _owns_guide boolean := false;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
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
  ELSIF _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id) THEN
    _chosen := _ship.preferred_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  IF _chosen IS NOT NULL
     AND (_ship.preferred_fish_id IS DISTINCT FROM _chosen) THEN
    UPDATE public.ships_owned SET preferred_fish_id = _chosen WHERE id = _ship_id;
    UPDATE public.inventory inv
       SET meta = COALESCE(inv.meta, '{}'::jsonb) || jsonb_build_object('preferred_fish_id', _chosen)
     WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
       AND inv.meta->>'assigned_ship_id' = _ship_id::text;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
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

  IF _client_progress IS NOT NULL AND _client_progress >= 0 THEN
    _base := LEAST(_base, _client_progress);
    IF _base < 1 THEN _base := 1; END IF;
  END IF;

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

    -- Log to competition_catches so active fishing events count correctly.
    -- Only log when an active fish-specific competition matches this fish.
    INSERT INTO public.competition_catches(user_id, fish_id, qty, source)
    SELECT _uid, _chosen, _qty, 'catch'
    WHERE EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.active = true
        AND c.metric = 'fish_specific'
        AND c.target_fish_id = _chosen
        AND now() BETWEEN c.starts_at AND c.ends_at
    );
  END IF;

  RETURN QUERY SELECT _chosen, _qty, _base, GREATEST(0, _qty - _base), _xp,
                      FLOOR(LEAST(_elapsed, _duration))::int, _duration;
END
$function$;

-- 2) Backfill missed phoenix catches for the current active event.
--    Source: fish_stock_audit inserts within event window (true catch record).
--    We insert only the delta beyond what's already logged, per user.
WITH ev AS (
  SELECT id, target_fish_id, starts_at, ends_at
  FROM public.competitions
  WHERE id = '933436d3-6ac4-446f-bd8d-481e015ad4dd'
),
audit_sums AS (
  SELECT a.user_id, SUM(a.qty_delta)::int AS caught
  FROM public.fish_stock_audit a, ev
  WHERE a.fish_id = ev.target_fish_id
    AND a.op = 'insert'
    AND a.qty_delta > 0
    AND a.changed_at >= ev.starts_at
    AND a.changed_at <  ev.ends_at
  GROUP BY a.user_id
),
comp_sums AS (
  SELECT cc.user_id, SUM(cc.qty)::int AS logged
  FROM public.competition_catches cc, ev
  WHERE cc.fish_id = ev.target_fish_id
    AND cc.caught_at >= ev.starts_at
    AND cc.caught_at <  ev.ends_at
  GROUP BY cc.user_id
)
INSERT INTO public.competition_catches (user_id, fish_id, qty, caught_at, source)
SELECT a.user_id,
       (SELECT target_fish_id FROM ev),
       (a.caught - COALESCE(c.logged, 0)),
       now(),
       'backfill'
FROM audit_sums a
LEFT JOIN comp_sums c ON c.user_id = a.user_id
WHERE (a.caught - COALESCE(c.logged, 0)) > 0;