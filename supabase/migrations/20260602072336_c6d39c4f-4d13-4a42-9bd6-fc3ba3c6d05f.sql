CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  SELECT * INTO _ship
  FROM public.ships_owned so
  WHERE so.id = _ship_id
  FOR UPDATE;

  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    UPDATE public.ships_owned so
       SET at_sea = false, fishing_started_at = NULL
     WHERE so.id = _ship_id;
    RAISE EXCEPTION 'ship_destroyed';
  END IF;

  IF NOT COALESCE(_ship.at_sea, false) OR _ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'not_fishing';
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog sc
    WHERE sc.code = _ship.catalog_code AND sc.active = true
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog sc
    WHERE sc.code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND sc.active = true
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog sc
    WHERE sc.sort_order = COALESCE(_ship.template_id, 1) AND sc.active = true
    ORDER BY sc.market_level_required ASC
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL THEN
    RAISE EXCEPTION 'ship_catalog_missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id = 'sailor'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _has_crew;
  IF _has_crew THEN _sailor_mult := 1.4; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id = 'luck'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _has_crew;
  IF _has_crew THEN _luck_mult := 2; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id = 'guide'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _has_crew;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN
    RAISE EXCEPTION 'empty_fish_pool';
  END IF;

  IF _has_crew
     AND _requested_fish_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSE
    SELECT p.value INTO _chosen
    FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len))
    LIMIT 1;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(
    1,
    CASE
      WHEN COALESCE(_ship.template_id, 0) = 32 THEN COALESCE(_ship.max_hp, _cat.storage, 10)
      ELSE COALESCE(_cat.storage, 10)
    END
  );
  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);
  _base := FLOOR(_capacity * _ratio)::integer;
  _base := GREATEST(1, _base);
  _qty := _base * _luck_mult;
  _xp := LEAST(50 + COALESCE(_ship.template_id, 1) * 40, GREATEST(5, FLOOR(_qty * 0.4)::integer + COALESCE(_ship.template_id, 1) * 5));

  UPDATE public.ships_owned so
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = now()
   WHERE so.id = _ship_id;

  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _chosen, _qty, _qty)
  ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
  SET quantity = public.fish_caught.quantity + _qty,
      total_caught = public.fish_caught.total_caught + _qty,
      updated_at = now();

  SELECT GREATEST(1, COALESCE(fmp.current_price::bigint, 1)) INTO _unit_value
  FROM public.fish_market_prices fmp
  WHERE fmp.fish_id = _chosen
  LIMIT 1;
  _unit_value := COALESCE(_unit_value, 1);

  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value)
  SELECT _uid, _chosen, _ship_id, now(), _unit_value
  FROM generate_series(1, LEAST(_qty, 500));

  INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
  VALUES (_uid, _chosen, now(), _qty);

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
$$;

REVOKE ALL ON FUNCTION public.collect_fishing_reward(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) TO service_role;

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
    SELECT fs.id, fs.fish_id, fs.base_value
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(SUM(base_value), 0)
    INTO _total
  FROM mine;

  WITH requested AS (
    SELECT DISTINCT unnest(_fish_stock_ids) AS id
  ), mine AS (
    SELECT fs.id, fs.fish_id
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(jsonb_object_agg(fish_id, cnt), '{}'::jsonb)
    INTO _sold_counts
  FROM (
    SELECT fish_id, COUNT(*)::int AS cnt
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

UPDATE public.ship_catalog
SET fish_pool = CASE code
  WHEN 'ship-lvl-1' THEN '["sardine"]'::jsonb
  WHEN 'ship-lvl-2' THEN '["sardine"]'::jsonb
  WHEN 'ship-lvl-3' THEN '["sardine","tuna"]'::jsonb
  WHEN 'ship-lvl-4' THEN '["sardine","shrimp"]'::jsonb
  WHEN 'ship-lvl-5' THEN '["sardine","shrimp","tuna"]'::jsonb
  WHEN 'ship-lvl-6' THEN '["grouper","shrimp"]'::jsonb
  WHEN 'ship-lvl-7' THEN '["squid","tuna"]'::jsonb
  WHEN 'ship-lvl-8' THEN '["squid","grouper"]'::jsonb
  WHEN 'ship-lvl-9' THEN '["grouper","carp"]'::jsonb
  WHEN 'ship-lvl-10' THEN '["eel","tang_blue","tuna"]'::jsonb
  WHEN 'ship-lvl-11' THEN '["stingray","goldfish"]'::jsonb
  WHEN 'ship-lvl-12' THEN '["shark","squid","snapper"]'::jsonb
  WHEN 'ship-lvl-13' THEN '["shark","tuna","squid"]'::jsonb
  WHEN 'ship-lvl-14' THEN '["grouper","eel","snapper"]'::jsonb
  WHEN 'ship-lvl-15' THEN '["tuna","shark","grouper"]'::jsonb
  WHEN 'ship-lvl-16' THEN '["squid","stingray","goldfish"]'::jsonb
  WHEN 'ship-lvl-17' THEN '["carp","tuna","grouper"]'::jsonb
  WHEN 'ship-lvl-18' THEN '["shark","squid","eel"]'::jsonb
  WHEN 'ship-lvl-19' THEN '["grouper","tuna","shark"]'::jsonb
  WHEN 'ship-lvl-20' THEN '["stingray","squid","snapper"]'::jsonb
  WHEN 'ship-lvl-21' THEN '["shark","grouper","tuna"]'::jsonb
  WHEN 'ship-lvl-22' THEN '["eel","carp","squid"]'::jsonb
  WHEN 'ship-lvl-23' THEN '["shark","tuna","stingray"]'::jsonb
  WHEN 'ship-lvl-24' THEN '["shark","tuna","squid","stingray","grouper","carp"]'::jsonb
  WHEN 'ship-lvl-25' THEN '["shark","tuna","grouper","carp"]'::jsonb
  WHEN 'ship-lvl-26' THEN '["shark","squid","tuna","stingray"]'::jsonb
  WHEN 'ship-lvl-27' THEN '["shark","tuna","grouper","squid","carp"]'::jsonb
  WHEN 'ship-lvl-28' THEN '["shark","stingray","tuna","grouper","squid","snapper","carp"]'::jsonb
  WHEN 'ship-lvl-29' THEN '["shark","tuna","stingray","grouper","squid"]'::jsonb
  WHEN 'ship-lvl-30' THEN '["shark","tuna","grouper","carp","squid","stingray","snapper","eel"]'::jsonb
  WHEN 'ship-lvl-31' THEN '["phoenix"]'::jsonb
  WHEN 'phoenix' THEN '["phoenix"]'::jsonb
  WHEN 'submarine' THEN '["abyss_titan"]'::jsonb
  ELSE fish_pool
END
WHERE code IN (
  'ship-lvl-1','ship-lvl-2','ship-lvl-3','ship-lvl-4','ship-lvl-5','ship-lvl-6','ship-lvl-7','ship-lvl-8','ship-lvl-9','ship-lvl-10',
  'ship-lvl-11','ship-lvl-12','ship-lvl-13','ship-lvl-14','ship-lvl-15','ship-lvl-16','ship-lvl-17','ship-lvl-18','ship-lvl-19','ship-lvl-20',
  'ship-lvl-21','ship-lvl-22','ship-lvl-23','ship-lvl-24','ship-lvl-25','ship-lvl-26','ship-lvl-27','ship-lvl-28','ship-lvl-29','ship-lvl-30',
  'ship-lvl-31','phoenix','submarine'
);