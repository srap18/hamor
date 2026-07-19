
-- Behavior-Preserving No-op elimination on public.fish_caught
-- Guards ON CONFLICT DO UPDATE clauses so they skip when the resulting row
-- would be byte-identical to the current row.

-- 1) increment_fish_caught: skip when _qty=0 (quantity+0 = no change)
CREATE OR REPLACE FUNCTION public.increment_fish_caught(_fish_id text, _qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid:=auth.uid();
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  INSERT INTO public.fish_caught(user_id,fish_id,quantity,total_caught) VALUES(_uid,_fish_id,_qty,_qty)
  ON CONFLICT(user_id,fish_id) DO UPDATE SET quantity=public.fish_caught.quantity+_qty,
    total_caught=public.fish_caught.total_caught+_qty, updated_at=now()
  WHERE COALESCE(_qty,0) <> 0;
END $function$;

-- 2) sell_fish: skip DO UPDATE when new quantity equals current quantity
--    (happens when public.fish_caught.quantity is already 0, so
--     GREATEST(0, 0 - x) = 0 = current). Preserves exact game state.
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
  _coins_before bigint;
  _coins_after bigint;
  _qty_total bigint := 0;
  _audit_threshold bigint := 100000;
  _expert_active boolean := false;
  _now timestamptz := now();
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _offset_seconds bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF COALESCE(array_length(_fish_stock_ids, 1), 0) = 0 THEN RETURN 0; END IF;

  PERFORM public._enforce_rate_limit('sell_fish', 500);
  PERFORM public._detect_bot_and_ban(_uid, 'sell_fish');
  IF EXISTS (SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
             AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT (market_expert_until IS NOT NULL AND market_expert_until > now())
    INTO _expert_active FROM public.profiles WHERE id = _uid;
  _expert_active := COALESCE(_expert_active, false);

  SELECT ums.freeze_until, ums.freeze_started_at, COALESCE(ums.rot_freeze_offset_seconds, 0)
    INTO _freeze_until, _freeze_started_at, _offset_seconds
    FROM public.user_market_state ums WHERE ums.user_id = _uid;

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id),
  mine AS (
    SELECT fs.id, fs.fish_id, fs.quantity, fs.caught_at, fs.base_value,
           fps.min_price AS fps_min, fps.max_price AS fps_max,
           fmp.min_price AS fmp_min, fmp.max_price AS fmp_max, fmp.current_price AS fmp_cur
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    LEFT JOIN public.fish_market_prices  fmp ON fmp.fish_id = fs.fish_id
    LEFT JOIN public.fish_price_settings fps ON fps.fish_id = fs.fish_id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  ),
  priced AS (
    SELECT m.*,
      GREATEST(0.5, 1 - 0.01 * (
        GREATEST(0, EXTRACT(EPOCH FROM (_now - m.caught_at))
          - COALESCE(_offset_seconds, 0)
          - CASE
              WHEN _freeze_started_at IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > _freeze_started_at
              THEN GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_freeze_until, _now) - GREATEST(_freeze_started_at, m.caught_at))))
              ELSE 0
            END
        ) / 3600.0
      ))::numeric AS rot,
      CASE
        WHEN _expert_active AND COALESCE(m.fps_max, m.fmp_max) IS NOT NULL
          THEN COALESCE(m.fps_max, m.fmp_max)::numeric
        ELSE GREATEST(1, COALESCE(NULLIF(m.base_value, 0), m.fmp_cur::bigint, 1))::numeric
      END AS base_unit
  )
  SELECT
    COALESCE(SUM(
      GREATEST(
        COALESCE(fps_min, fmp_min, 1)::numeric,
        LEAST(
          COALESCE(fps_max, fmp_max, 999999999)::numeric,
          base_unit * rot
        )
      )::bigint * quantity
    ), 0),
    COALESCE(SUM(quantity), 0)
  INTO _total, _qty_total
  FROM priced;

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id),
  mine AS (
    SELECT fs.id, fs.fish_id, fs.quantity FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id WHERE fs.user_id = _uid FOR UPDATE OF fs
  )
  SELECT COALESCE(jsonb_object_agg(fish_id, cnt), '{}'::jsonb) INTO _sold_counts
  FROM (SELECT fish_id, SUM(quantity)::int AS cnt FROM mine GROUP BY fish_id) s;

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id)
  DELETE FROM public.fish_stock fs USING requested r
  WHERE fs.id = r.id AND fs.user_id = _uid;

  IF _sold_counts IS NOT NULL AND _sold_counts <> '{}'::jsonb THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    SELECT _uid, key, 0, (value)::int FROM jsonb_each_text(_sold_counts)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                  updated_at = now()
    WHERE public.fish_caught.quantity
          IS DISTINCT FROM GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught);
  END IF;

  IF _total > 0 THEN
    SELECT COALESCE(coins, 0) INTO _coins_before FROM public.profiles WHERE id = _uid;
    PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
    SELECT COALESCE(coins, 0) INTO _coins_after FROM public.profiles WHERE id = _uid;
    IF _total >= _audit_threshold THEN
      INSERT INTO public.transaction_logs(
        user_id, kind, item_id, quantity, unit_price,
        total_amount, balance_before, balance_after, meta
      ) VALUES (
        _uid, 'sell_fish', NULL, _qty_total,
        CASE WHEN _qty_total > 0 THEN (_total / _qty_total) ELSE 0 END,
        _total, _coins_before, _coins_after,
        jsonb_build_object('sold_counts', _sold_counts, 'stock_ids_count', array_length(_fish_stock_ids,1), 'market_expert', _expert_active, 'rot_applied', true)
      );
    END IF;
    PERFORM public._record_fish_sale_gold(_uid, _total);
  END IF;

  RETURN _total;
END;
$function$;

-- 3) sell_fish_by_qty: same guard as above on the ON CONFLICT UPDATE
CREATE OR REPLACE FUNCTION public.sell_fish_by_qty(_fish_id text, _qty integer, _client_version text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _quoted_sold integer := 0;
  _sold integer := 0;
  _remaining integer := 0;
  _current_price numeric := 0;
  _rot numeric := 1;
  _effective_unit_price numeric := 0;
  _balance_before bigint := 0;
  _stock_id uuid;
  _stock_qty integer;
  _take integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _client_version IS DISTINCT FROM 'fish-market-v20260626-force-update-1' THEN
    RAISE EXCEPTION 'update_required: حدث اللعبة ثم حاول مرة ثانية' USING ERRCODE = 'P0001';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  SET LOCAL lock_timeout = '2500ms';
  PERFORM set_config('app.audit_source', 'sell_fish_by_qty', true);
  PERFORM set_config('app.audit_reason', 'fish_sale_fast', true);
  PERFORM public._enforce_rate_limit('sell_fish', 500);
  PERFORM pg_advisory_xact_lock(hashtextextended('sell_fish:' || _uid::text, 0));

  SELECT q.sold, q.total_amount, q.effective_unit_price, q.current_price, q.rot
    INTO _quoted_sold, _total, _effective_unit_price, _current_price, _rot
    FROM public.quote_fish_sale_by_qty(_fish_id, _qty) q;
  IF COALESCE(_quoted_sold, 0) <= 0 OR COALESCE(_total, 0) <= 0 THEN RETURN 0; END IF;

  _remaining := _quoted_sold;
  WHILE _remaining > 0 LOOP
    SELECT fs.id, fs.quantity INTO _stock_id, _stock_qty
      FROM public.fish_stock fs
     WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0
     ORDER BY fs.caught_at ASC, fs.id ASC
     LIMIT 1 FOR UPDATE;
    IF _stock_id IS NULL OR COALESCE(_stock_qty, 0) <= 0 THEN EXIT; END IF;
    _take := LEAST(_stock_qty, _remaining);
    IF _take >= _stock_qty THEN
      DELETE FROM public.fish_stock WHERE id = _stock_id;
    ELSE
      UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _stock_id;
    END IF;
    _sold := _sold + _take;
    _remaining := _remaining - _take;
    _stock_id := NULL;
    _stock_qty := NULL;
  END LOOP;

  IF COALESCE(_sold, 0) <= 0 THEN RETURN 0; END IF;
  _total := GREATEST(0, ROUND(_effective_unit_price * _sold))::bigint;
  IF _total <= 0 THEN RETURN 0; END IF;

  SELECT coins INTO _balance_before FROM public.profiles WHERE id = _uid FOR UPDATE;
  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _fish_id, 0, _sold)
  ON CONFLICT (user_id, fish_id)
  DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught),
                updated_at = now()
  WHERE public.fish_caught.quantity
        IS DISTINCT FROM GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught);

  PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
  IF _total >= 100000 THEN
    INSERT INTO public.transaction_logs(user_id, kind, item_id, quantity, unit_price, total_amount, balance_before, balance_after, meta)
    VALUES (_uid, 'fish_sale', _fish_id, _sold, GREATEST(0, ROUND(_effective_unit_price))::bigint, _total, COALESCE(_balance_before, 0), COALESCE(_balance_before, 0) + _total,
      jsonb_build_object('requested_qty', _qty, 'current_price', _current_price, 'rot', _rot, 'effective_unit_price', _effective_unit_price, 'client_version', _client_version, 'sale_mode', 'single_fast'));
  END IF;

  PERFORM public._record_fish_sale_gold(_uid, _total);
  RETURN _total;
END;
$function$;
