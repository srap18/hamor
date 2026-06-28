
-- 1) Track activation expiry on the player profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS market_expert_until timestamptz;

-- 2) Helper: returns the max-price override for a fish when the buff is active,
--    NULL otherwise. Falls back to NULL if no max_price configured.
CREATE OR REPLACE FUNCTION public._market_expert_max_price(_uid uuid, _fish_id text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.market_expert_until IS NOT NULL
         AND p.market_expert_until > now()
         AND fps.max_price IS NOT NULL
         AND fps.max_price > 0
    THEN fps.max_price::numeric
    ELSE NULL
  END
  FROM public.profiles p
  LEFT JOIN public.fish_price_settings fps ON fps.fish_id = _fish_id
  WHERE p.id = _uid;
$$;

REVOKE ALL ON FUNCTION public._market_expert_max_price(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._market_expert_max_price(uuid, text) TO authenticated, service_role;

-- 3) Quote: override unit price with max_price when buff active, skip rot
CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(_fish_id text, _qty integer)
RETURNS TABLE(sold integer, total_amount bigint, effective_unit_price numeric, current_price numeric, rot numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current_price numeric := 0;
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
  _oldest_caught timestamptz;
  _hours numeric := 0;
  _available integer := 0;
  _max_override numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(NULLIF(fmp.current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices AS fmp
   WHERE fmp.fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  SELECT ums.freeze_until, ums.freeze_started_at
    INTO _freeze_until, _freeze_started_at
    FROM public.user_market_state AS ums
   WHERE ums.user_id = _uid;

  IF _freeze_until IS NOT NULL AND _freeze_until > _now AND _freeze_started_at IS NOT NULL THEN
    _age_end := _freeze_started_at;
  ELSE
    _age_end := _now;
  END IF;

  SELECT MIN(fs.caught_at), COALESCE(SUM(fs.quantity), 0)::integer
    INTO _oldest_caught, _available
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _oldest_caught IS NULL OR _available <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  _hours := GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(_age_end, _oldest_caught) - _oldest_caught)) / 3600.0);
  rot := GREATEST(0.5, 1 - 0.01 * _hours);

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    -- Market Expert active: pay top price for this fish, ignore rot and current price.
    effective_unit_price := _max_override;
    rot := 1::numeric;
  ELSE
    effective_unit_price := GREATEST(0.0001, _current_price * rot);
  END IF;

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;

  RETURN NEXT;
END;
$function$;

-- 4) Bulk sell_fish: apply max_price per fish when buff active
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
    INTO _expert_active
    FROM public.profiles WHERE id = _uid;
  _expert_active := COALESCE(_expert_active, false);

  WITH requested AS (SELECT DISTINCT unnest(_fish_stock_ids) AS id),
  mine AS (
    SELECT fs.id, fs.fish_id, fs.quantity,
      CASE
        WHEN _expert_active AND fps.max_price IS NOT NULL AND fps.max_price > 0
          THEN fps.max_price::bigint
        ELSE GREATEST(1, COALESCE(NULLIF(fs.base_value, 0), fmp.current_price::bigint, 1))
      END AS unit_value
    FROM public.fish_stock fs
    JOIN requested r ON r.id = fs.id
    LEFT JOIN public.fish_market_prices fmp ON fmp.fish_id = fs.fish_id
    LEFT JOIN public.fish_price_settings fps ON fps.fish_id = fs.fish_id
    WHERE fs.user_id = _uid
    FOR UPDATE OF fs
  )
  SELECT COALESCE(SUM(unit_value * quantity), 0), COALESCE(SUM(quantity), 0)
    INTO _total, _qty_total FROM mine;

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
                  updated_at = now();
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
        jsonb_build_object('sold_counts', _sold_counts, 'stock_ids_count', array_length(_fish_stock_ids,1), 'market_expert', _expert_active)
      );
    END IF;
  END IF;

  RETURN _total;
END;
$function$;

-- 5) sell_fish_caught: apply max_price when buff active
CREATE OR REPLACE FUNCTION public.sell_fish_caught(_fish_id text, _qty integer, _unit_price numeric DEFAULT NULL::numeric)
RETURNS TABLE(remaining integer, coins_earned bigint, new_coins bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _have integer;
  _sell integer;
  _earned bigint;
  _new_coins bigint;
  _remaining integer;
  _market_price numeric;
  _caught_at timestamptz;
  _freeze_started timestamptz;
  _freeze_until timestamptz;
  _age_end timestamptz;
  _hours numeric;
  _rot numeric;
  _final_unit numeric;
  _max_override numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'invalid qty'; END IF;

  SELECT quantity, updated_at INTO _have, _caught_at
  FROM public.fish_caught
  WHERE user_id = _uid AND fish_id = _fish_id
  FOR UPDATE;

  IF _have IS NULL OR _have <= 0 THEN
    RAISE EXCEPTION 'no fish to sell';
  END IF;

  SELECT current_price INTO _market_price
  FROM public.fish_market_prices
  WHERE fish_id = _fish_id;

  IF _market_price IS NULL OR _market_price <= 0 THEN
    _market_price := GREATEST(0.1, COALESCE(_unit_price, 0.1));
  END IF;

  SELECT freeze_started_at, freeze_until INTO _freeze_started, _freeze_until
  FROM public.user_market_state
  WHERE user_id = _uid;

  _age_end := now();
  IF _freeze_started IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > now() THEN
    _age_end := GREATEST(_caught_at, _freeze_started);
  END IF;

  _hours := GREATEST(0, EXTRACT(EPOCH FROM (_age_end - _caught_at)) / 3600.0);
  _rot := GREATEST(0.5, 1 - (0.01 * _hours));

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    _final_unit := _max_override;
    _rot := 1::numeric;
  ELSE
    _final_unit := GREATEST(0.1, round((_market_price * _rot)::numeric, 2));
  END IF;

  _sell := LEAST(_qty, _have);
  _remaining := _have - _sell;
  _earned := (_sell::numeric * _final_unit)::bigint;

  IF _remaining > 0 THEN
    UPDATE public.fish_caught
    SET quantity = _remaining
    WHERE user_id = _uid AND fish_id = _fish_id;
  ELSE
    DELETE FROM public.fish_caught
    WHERE user_id = _uid AND fish_id = _fish_id;
  END IF;

  UPDATE public.profiles
  SET coins = coins + _earned
  WHERE id = _uid
  RETURNING coins INTO _new_coins;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'fish_sale', _earned, 'coins', jsonb_build_object(
    'fish_id', _fish_id,
    'qty', _sell,
    'unit_price', _final_unit,
    'quality_pct', round((_rot * 100)::numeric, 2),
    'server_priced', true,
    'market_expert', _max_override IS NOT NULL
  ));

  remaining := _remaining;
  coins_earned := _earned;
  new_coins := _new_coins;
  RETURN NEXT;
END;
$function$;

-- 6) Activation RPC: consumes one "market_expert" crew from inventory and extends buff by 3h
CREATE OR REPLACE FUNCTION public.activate_market_expert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _current timestamptz;
  _new_until timestamptz;
  _base timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT market_expert_until INTO _current
    FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row
    FROM public.inventory
   WHERE user_id = _uid
     AND item_type = 'crew'
     AND item_id = 'market_expert'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
     AND quantity > 0
   ORDER BY acquired_at ASC
   FOR UPDATE
   LIMIT 1;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'no_market_expert_in_inventory';
  END IF;

  IF _row.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
  END IF;

  _base := GREATEST(COALESCE(_current, now()), now());
  _new_until := _base + interval '3 hours';

  UPDATE public.profiles
    SET market_expert_until = _new_until
  WHERE id = _uid;

  RETURN jsonb_build_object('ok', true, 'until', _new_until);
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_market_expert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_market_expert() TO authenticated;
