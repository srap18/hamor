
-- 1) collect_fishing_reward: XP = quantity (1 XP per fish), no cap
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
  _hp_ratio numeric := 1;
  _still_repairing boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    _hp_ratio := public._ship_repair_ratio(_ship.destroyed_at, _ship.repair_ends_at);
    IF _hp_ratio < 0.30 THEN
      UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
    _still_repairing := true;
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

  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'sailor' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _sailor_mult := 1.0 / 0.5; END IF;
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
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

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

  -- XP = quantity caught (1 XP per fish), no cap
  _xp := _qty;

  UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = now() WHERE so.id = _ship_id;

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
    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
  END IF;

  fish_id := _chosen; fish_qty := _qty; base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base); xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer; duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;

-- 2) sell_fish: no XP
CREATE OR REPLACE FUNCTION public.sell_fish(_fish_stock_ids uuid[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _sold_counts jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF COALESCE(array_length(_fish_stock_ids, 1), 0) = 0 THEN RETURN 0; END IF;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  ), mine AS (
    SELECT
      fs.id,
      fs.fish_id,
      fs.quantity,
      GREATEST(1, COALESCE(NULLIF(fs.base_value, 0), fmp.current_price::bigint, 1)) AS unit_value
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    LEFT JOIN public.fish_market_prices fmp ON fmp.fish_id = fs.fish_id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(SUM(unit_value * quantity), 0)
    INTO _total
  FROM mine;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  ), mine AS (
    SELECT fs.id, fs.fish_id, fs.quantity
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(jsonb_object_agg(fish_id, cnt), '{}'::jsonb)
    INTO _sold_counts
  FROM (
    SELECT fish_id, SUM(quantity)::int AS cnt
    FROM mine
    GROUP BY fish_id
  ) s;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  )
  DELETE FROM public.fish_stock fs
  USING requested r
  WHERE fs.id = r.id AND fs.user_id = _uid;

  IF _sold_counts IS NOT NULL AND _sold_counts <> '{}'::jsonb THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    SELECT _uid, key, 0, (value)::int
      FROM jsonb_each_text(_sold_counts)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                  updated_at = now();
  END IF;

  IF _total > 0 THEN
    PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
  END IF;
  RETURN _total;
END;
$function$;

-- 3) sell_fish_by_qty: no XP
CREATE OR REPLACE FUNCTION public.sell_fish_by_qty(_fish_id text, _qty integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _sold integer := 0;
  _current_price numeric := 0;
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':' || _fish_id, 0));

  SELECT COALESCE(NULLIF(current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices
   WHERE fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  SELECT freeze_until, freeze_started_at
    INTO _freeze_until, _freeze_started_at
    FROM public.user_market_state
   WHERE user_id = _uid;

  IF _freeze_until IS NOT NULL AND _freeze_until > _now AND _freeze_started_at IS NOT NULL THEN
    _age_end := _freeze_started_at;
  ELSE
    _age_end := _now;
  END IF;

  WITH ordered AS (
    SELECT id, quantity, caught_at,
           SUM(quantity) OVER (ORDER BY caught_at ASC, id ASC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
      FROM public.fish_stock
     WHERE user_id = _uid AND fish_id = _fish_id AND quantity > 0
  ),
  picked AS (
    SELECT id, quantity, caught_at,
           LEAST(quantity, GREATEST(0, _qty - (cum - quantity)))::int AS take
      FROM ordered
     WHERE cum - quantity < _qty
  ),
  priced AS (
    SELECT id, quantity, take,
      GREATEST(1, ROUND(
        _current_price * GREATEST(0.5, 1 - 0.01 * GREATEST(0,
          EXTRACT(EPOCH FROM (GREATEST(_age_end, caught_at) - caught_at)) / 3600.0
        ))
      ))::bigint AS per_fish
      FROM picked
     WHERE take > 0
  ),
  del AS (
    DELETE FROM public.fish_stock fs
      USING priced p
     WHERE fs.id = p.id AND p.take >= p.quantity
    RETURNING fs.id
  ),
  upd AS (
    UPDATE public.fish_stock fs
       SET quantity = fs.quantity - p.take
      FROM priced p
     WHERE fs.id = p.id AND p.take > 0 AND p.take < p.quantity
    RETURNING fs.id
  )
  SELECT COALESCE(SUM(per_fish * take), 0)::bigint,
         COALESCE(SUM(take), 0)::int
    INTO _total, _sold
    FROM priced;

  IF _sold > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _fish_id, 0, _sold)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                  updated_at = now();
  END IF;

  IF _total > 0 THEN
    PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
  END IF;

  RETURN _total;
END;
$function$;
