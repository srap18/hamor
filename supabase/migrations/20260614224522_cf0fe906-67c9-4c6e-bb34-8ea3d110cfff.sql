
-- HP-based fishing eligibility (>= 30% HP can fish), and clear "destroyed"
-- state when a partial repair brings HP to 30% or more.

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
  _has_guide boolean := false; _guide_pref text;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _grace_seconds constant numeric := 5;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  -- HP-based capability: any ship with >= 30% HP can fish.
  -- Capacity scales linearly with current HP ratio (min 5%).
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

  IF _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> '' THEN
    _guide_pref := _ship.preferred_fish_id;
  END IF;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _has_guide AND _requested_fish_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  IF _has_guide AND _chosen IS NOT NULL
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

  IF _market_remaining <= 0 THEN
    RAISE EXCEPTION 'market_full';
  END IF;

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
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
    SET quantity = public.fish_caught.quantity + _qty,
        total_caught = public.fish_caught.total_caught + _qty,
        updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen;
    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _chosen, _ship_id, now(), _unit_value, _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_uid, _chosen, now(), _qty);
  END IF;

  fish_id := _chosen; fish_qty := _qty; base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base); xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer; duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;

-- Partial repair (fixer_1/2/3): clear "destroyed" state once HP reaches >= 30%,
-- so the ship can fish and the UI stops showing the destroyed/timer state.
CREATE OR REPLACE FUNCTION public.repair_ship_with_crew(_ship_id uuid, _crew_id text)
RETURNS TABLE(new_hp integer, max_hp integer, repair_ends_at timestamp with time zone, repaired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _ship record;
  _heal integer;
  _new_hp integer;
  _count integer := 0;
  _clear boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _crew_id NOT IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN RAISE EXCEPTION 'unsupported crew'; END IF;

  SELECT inv.id, inv.quantity INTO _inv
  FROM public.inventory AS inv
  WHERE inv.user_id = _uid
    AND inv.item_type = 'crew'
    AND inv.item_id = _crew_id
    AND (inv.meta IS NULL OR inv.meta->>'assigned_ship_id' IS NULL)
  ORDER BY inv.acquired_at, inv.id
  LIMIT 1 FOR UPDATE;

  IF _inv.id IS NULL OR COALESCE(_inv.quantity, 0) < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned AS so
       SET hp = so.max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL,
           at_sea = false,
           fishing_started_at = NULL
     WHERE so.user_id = _uid
       AND (COALESCE(so.hp, 0) < COALESCE(so.max_hp, 100) OR so.destroyed_at IS NOT NULL OR so.repair_ends_at IS NOT NULL);
    GET DIAGNOSTICS _count = ROW_COUNT;
    IF _count < 1 THEN RAISE EXCEPTION 'no ships need repair'; END IF;

    IF _inv.quantity <= 1 THEN
      DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
    ELSE
      UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
    END IF;

    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::timestamp with time zone, _count;
    RETURN;
  END IF;

  _heal := CASE _crew_id
    WHEN 'fixer_1' THEN 1000
    WHEN 'fixer_2' THEN 5000
    WHEN 'fixer_3' THEN 70000
    ELSE 0
  END;

  SELECT so.* INTO _ship
  FROM public.ships_owned AS so
  WHERE so.id = _ship_id AND so.user_id = _uid
  FOR UPDATE;

  IF _ship.id IS NULL THEN RAISE EXCEPTION 'not your ship'; END IF;
  IF COALESCE(_ship.hp, 0) >= COALESCE(_ship.max_hp, 100)
     AND _ship.destroyed_at IS NULL
     AND _ship.repair_ends_at IS NULL THEN
    RAISE EXCEPTION 'ship does not need repair';
  END IF;

  _new_hp := LEAST(COALESCE(_ship.max_hp, 100), GREATEST(0, COALESCE(_ship.hp, 0)) + _heal);

  -- Clear destroyed state when HP reaches full OR at least 30% of max.
  _clear := _new_hp >= COALESCE(_ship.max_hp, 100)
         OR _new_hp::numeric >= 0.30 * COALESCE(_ship.max_hp, 100)::numeric;

  UPDATE public.ships_owned AS so
     SET hp = _new_hp,
         destroyed_at = CASE WHEN _clear THEN NULL ELSE so.destroyed_at END,
         repair_ends_at = CASE WHEN _clear THEN NULL ELSE so.repair_ends_at END
   WHERE so.id = _ship.id;

  IF _inv.quantity <= 1 THEN
    DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
  ELSE
    UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
  END IF;

  RETURN QUERY SELECT _new_hp, COALESCE(_ship.max_hp, 100),
    CASE WHEN _clear THEN NULL::timestamptz ELSE _ship.repair_ends_at END,
    1;
END;
$function$;

-- Auto-heal existing ships that already have >= 30% HP but are stuck in
-- "destroyed" state from previous partial repairs.
UPDATE public.ships_owned
   SET destroyed_at = NULL, repair_ends_at = NULL
 WHERE destroyed_at IS NOT NULL
   AND max_hp IS NOT NULL
   AND max_hp > 0
   AND hp IS NOT NULL
   AND hp::numeric >= 0.30 * max_hp::numeric;
