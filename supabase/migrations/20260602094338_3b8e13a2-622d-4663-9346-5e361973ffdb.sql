-- 1) Add quantity column to fish_stock (one row per fishing trip)
ALTER TABLE public.fish_stock
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_fish_stock_user_fish ON public.fish_stock(user_id, fish_id);

-- 2) collect_fishing_reward: no cap, single aggregated row
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len integer;
  _chosen text;
  _capacity integer;
  _duration integer;
  _elapsed numeric;
  _ratio numeric;
  _sailor_mult numeric := 1;
  _luck_mult integer := 1;
  _has_crew boolean := false;
  _base integer;
  _qty integer;
  _xp integer;
  _unit_value bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
    RAISE EXCEPTION 'ship_destroyed';
  END IF;

  IF _ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'not_fishing';
  END IF;

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
  IF _has_crew THEN _sailor_mult := 1.4; END IF;

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
  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);
  _base := FLOOR(_capacity * _ratio)::integer;
  _base := GREATEST(_base, 1);
  _base := LEAST(_base, _capacity);
  _qty := _base * _luck_mult;
  _xp := LEAST(50 + COALESCE(_ship.template_id, 1) * 40, GREATEST(5, FLOOR(_qty * 0.4)::integer + COALESCE(_ship.template_id, 1) * 5));

  UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = now() WHERE so.id = _ship_id;

  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _chosen, _qty, _qty)
  ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
  SET quantity = public.fish_caught.quantity + _qty,
      total_caught = public.fish_caught.total_caught + _qty,
      updated_at = now();

  SELECT GREATEST(1, COALESCE(fmp.current_price::bigint, 1)) INTO _unit_value FROM public.fish_market_prices fmp WHERE fmp.fish_id = _chosen LIMIT 1;
  _unit_value := COALESCE(_unit_value, 1);

  -- Single aggregated row per trip (no per-fish row, no cap)
  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
  VALUES (_uid, _chosen, _ship_id, now(), _unit_value, _qty);

  INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_uid, _chosen, now(), _qty);
  PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);

  fish_id := _chosen;
  fish_qty := _qty;
  base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base);
  xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer;
  duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;

-- 3) get_fish_stock_summary: sum quantity
CREATE OR REPLACE FUNCTION public.get_fish_stock_summary()
RETURNS TABLE(fish_id text, qty bigint, oldest_caught_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fish_id, COALESCE(SUM(quantity),0)::bigint AS qty, MIN(caught_at) AS oldest_caught_at
  FROM public.fish_stock
  WHERE user_id = auth.uid()
  GROUP BY fish_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_fish_stock_summary() TO authenticated;

-- 4) sell_fish: multiply by quantity
CREATE OR REPLACE FUNCTION public.sell_fish(_fish_stock_ids uuid[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _xp_gain integer := 0;
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
    _xp_gain := LEAST(200, GREATEST(1, (_total / 250)::int));
    PERFORM public._mutate_currency(_uid, _total, 0, 0, _xp_gain);
  END IF;
  RETURN _total;
END;
$$;

REVOKE ALL ON FUNCTION public.sell_fish(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_fish(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_fish(uuid[]) TO service_role;

-- 5) feed_daughter: consume up to _remaining fish across rows, splitting last row if needed
CREATE OR REPLACE FUNCTION public.feed_daughter(_fish_stock_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _count int := 0;
  _xp_gain int := 0;
  _old_stage int; _new_stage int;
  _new_total int;
  _today DATE := (now() AT TIME ZONE 'UTC')::date;
  _used_today INT;
  _remaining INT;
  _row record;
  _take INT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _fish_stock_ids IS NULL OR array_length(_fish_stock_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no fish provided';
  END IF;

  INSERT INTO public.player_daughter (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;

  UPDATE public.player_daughter
    SET feed_count_today = CASE WHEN feed_day = _today THEN feed_count_today ELSE 0 END,
        feed_day = _today
    WHERE user_id = _uid;

  SELECT feed_count_today INTO _used_today FROM public.player_daughter WHERE user_id = _uid;
  _remaining := GREATEST(0, 10 - COALESCE(_used_today, 0));

  IF _remaining = 0 THEN
    RAISE EXCEPTION 'daily_limit_reached';
  END IF;

  FOR _row IN
    SELECT id, quantity, base_value
    FROM public.fish_stock
    WHERE id = ANY(_fish_stock_ids) AND user_id = _uid
    ORDER BY caught_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN _remaining <= 0;
    _take := LEAST(_row.quantity, _remaining);
    _count := _count + _take;
    _xp_gain := _xp_gain + GREATEST(1, (_row.base_value/100)::int) * _take;
    _remaining := _remaining - _take;

    IF _take >= _row.quantity THEN
      DELETE FROM public.fish_stock WHERE id = _row.id;
    ELSE
      UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
    END IF;
  END LOOP;

  IF _count = 0 THEN RAISE EXCEPTION 'no matching fish'; END IF;

  SELECT stage INTO _old_stage FROM public.player_daughter WHERE user_id = _uid;

  UPDATE public.player_daughter
    SET feed_xp = feed_xp + _xp_gain,
        total_fish_fed = total_fish_fed + _count,
        feed_count_today = feed_count_today + _count,
        feed_day = _today,
        last_fed_at = now(),
        updated_at = now()
    WHERE user_id = _uid
    RETURNING total_fish_fed INTO _new_total;

  _new_stage := public._daughter_stage_for(_new_total);
  IF _new_stage <> _old_stage THEN
    UPDATE public.player_daughter SET stage = _new_stage WHERE user_id = _uid;
  END IF;

  RETURN jsonb_build_object(
    'fed_count', _count,
    'xp_gained', _xp_gain,
    'old_stage', _old_stage,
    'new_stage', _new_stage,
    'leveled_up', _new_stage > _old_stage,
    'total_fish_fed', _new_total,
    'remaining_today', GREATEST(0, 10 - (COALESCE(_used_today,0) + _count))
  );
END $$;
