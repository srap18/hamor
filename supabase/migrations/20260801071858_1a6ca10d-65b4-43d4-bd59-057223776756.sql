CREATE OR REPLACE FUNCTION public.buy_market_freeze(_hours integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _now timestamptz := now();
  _cur_started timestamptz;
  _cur_until timestamptz;
  _cur_frozen jsonb;
  _new_until timestamptz;
  _new_started timestamptz;
  _snapshot jsonb;
  _cap timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;

  -- Hard ceiling: a player can never hold more than 24 hours of freeze at once.
  _cap := _now + interval '24 hours';

  SELECT ums.freeze_started_at, ums.freeze_until, COALESCE(ums.frozen_prices, '{}'::jsonb)
    INTO _cur_started, _cur_until, _cur_frozen
    FROM public.user_market_state ums
   WHERE ums.user_id = _uid
   FOR UPDATE;

  IF _cur_until IS NOT NULL AND _cur_until >= _cap THEN
    RAISE EXCEPTION 'التجميد لديك ممتلئ (الحد الأقصى 24 ساعة) — استخدمه قبل الشراء مرة أخرى';
  END IF;

  UPDATE public.profiles
     SET gems = gems - _cost
   WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;

  IF _cur_until IS NOT NULL AND _cur_until > _now AND _cur_started IS NOT NULL THEN
    _new_started := GREATEST(_cur_started, _now - interval '24 hours');
    _new_until   := LEAST(_cur_until + (_hours || ' hours')::interval, _cap);
    _snapshot    := COALESCE(_cur_frozen, '{}'::jsonb); -- keep existing floor
  ELSE
    _new_started := _now;
    _new_until   := LEAST(_now + (_hours || ' hours')::interval, _cap);
    SELECT COALESCE(jsonb_object_agg(fmp.fish_id,
      GREATEST(
        COALESCE(fps.min_price, fmp.min_price, 0.0001)::numeric,
        LEAST(
          COALESCE(fps.max_price, fmp.max_price, 999999999)::numeric,
          COALESCE(NULLIF(fmp.current_price, 0), 1)::numeric
        )
      )
    ), '{}'::jsonb)
      INTO _snapshot
      FROM public.fish_market_prices fmp
      LEFT JOIN public.fish_price_settings fps ON fps.fish_id = fmp.fish_id;
  END IF;

  -- Freeze pauses rot ONLY inside its own window; no global carry-over offset.
  INSERT INTO public.user_market_state(user_id, freeze_started_at, freeze_until, rot_freeze_offset_seconds, frozen_prices, updated_at)
  VALUES (_uid, _new_started, _new_until, 0, _snapshot, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_started_at = EXCLUDED.freeze_started_at,
        freeze_until = EXCLUDED.freeze_until,
        rot_freeze_offset_seconds = 0,
        frozen_prices = EXCLUDED.frozen_prices,
        updated_at = _now;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'market_rot_freeze', -_cost, 'gems',
          jsonb_build_object('hours', _hours, 'extended', (_cur_until IS NOT NULL AND _cur_until > _now), 'capped', true));

  RETURN _new_until;
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(_fish_id text, _qty integer)
 RETURNS TABLE(sold integer, total_amount bigint, effective_unit_price numeric, current_price numeric, rot numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current_price numeric := 0;
  _freeze_until timestamptz; _freeze_started_at timestamptz;
  _now timestamptz := now();
  _oldest_caught timestamptz; _hours numeric := 0;
  _available integer := 0; _max_override numeric;
  _unit_base numeric;
  _freeze_used_seconds numeric := 0; _elapsed_seconds numeric := 0;
  _min_bound numeric; _max_bound numeric;
  _frozen_prices jsonb;
  _frozen_price numeric;
  _freeze_active boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(NULLIF(fmp.current_price, 0), 1) INTO _current_price
    FROM public.fish_market_prices AS fmp WHERE fmp.fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  SELECT min_p, max_p INTO _min_bound, _max_bound FROM public._fish_price_bounds(_fish_id);
  _current_price := GREATEST(_min_bound, LEAST(_max_bound, _current_price));

  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric; RETURN;
  END IF;

  SELECT ums.freeze_until, ums.freeze_started_at, COALESCE(ums.frozen_prices, '{}'::jsonb)
    INTO _freeze_until, _freeze_started_at, _frozen_prices
    FROM public.user_market_state AS ums WHERE ums.user_id = _uid;

  _freeze_active := (_freeze_until IS NOT NULL AND _freeze_until > _now);

  IF _freeze_active AND _frozen_prices ? _fish_id THEN
    _frozen_price := GREATEST(_min_bound, LEAST(_max_bound, (_frozen_prices ->> _fish_id)::numeric));
  ELSE
    _frozen_price := NULL;
  END IF;

  SELECT COALESCE(SUM(fs.quantity), 0), MIN(fs.caught_at)
    INTO _available, _oldest_caught
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _available <= 0 OR _oldest_caught IS NULL THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric; RETURN;
  END IF;

  IF _freeze_started_at IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > _freeze_started_at THEN
    _freeze_used_seconds := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(_freeze_until, _now) - GREATEST(_freeze_started_at, _oldest_caught))));
  END IF;

  _elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (_now - _oldest_caught)) - _freeze_used_seconds);
  _hours := _elapsed_seconds / 3600.0;
  rot := GREATEST(0.5, 1 - 0.01 * _hours);

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    _unit_base := _max_override;
  ELSE
    _unit_base := _current_price;
  END IF;

  effective_unit_price := _unit_base * rot;

  IF _frozen_price IS NOT NULL THEN
    effective_unit_price := GREATEST(effective_unit_price, _frozen_price);
  END IF;

  effective_unit_price := GREATEST(0, LEAST(_max_bound, effective_unit_price));

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;
  RETURN NEXT;
END;
$function$;

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

  SELECT ums.freeze_until, ums.freeze_started_at
    INTO _freeze_until, _freeze_started_at
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