
-- Audit log table for high-value sales
CREATE TABLE public.transaction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  item_id text,
  quantity bigint NOT NULL DEFAULT 0,
  unit_price bigint NOT NULL DEFAULT 0,
  total_amount bigint NOT NULL DEFAULT 0,
  balance_before bigint NOT NULL DEFAULT 0,
  balance_after bigint NOT NULL DEFAULT 0,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.transaction_logs TO authenticated;
GRANT ALL ON public.transaction_logs TO service_role;

ALTER TABLE public.transaction_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own logs" ON public.transaction_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins read all logs" ON public.transaction_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_transaction_logs_user_created ON public.transaction_logs(user_id, created_at DESC);
CREATE INDEX idx_transaction_logs_kind_created ON public.transaction_logs(kind, created_at DESC);

-- Rate limit tracker (in-memory style using table; one row per user per action)
CREATE TABLE public.user_action_throttle (
  user_id uuid NOT NULL,
  action text NOT NULL,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action)
);

GRANT SELECT, INSERT, UPDATE ON public.user_action_throttle TO authenticated;
GRANT ALL ON public.user_action_throttle TO service_role;

ALTER TABLE public.user_action_throttle ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own throttle" ON public.user_action_throttle
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Helper: enforce minimum interval between calls per (user, action)
CREATE OR REPLACE FUNCTION public._enforce_rate_limit(_action text, _min_ms int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _last timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.user_action_throttle(user_id, action, last_at)
  VALUES (_uid, _action, now())
  ON CONFLICT (user_id, action) DO UPDATE
    SET last_at = EXCLUDED.last_at
  RETURNING (SELECT last_at FROM public.user_action_throttle WHERE user_id=_uid AND action=_action) INTO _last;

  -- Check previous timestamp before the upsert overwrote it
  -- We do it differently: lock & read, then update
END;
$$;

-- Better: replace with a proper version
CREATE OR REPLACE FUNCTION public._enforce_rate_limit(_action text, _min_ms int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _prev timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT last_at INTO _prev
    FROM public.user_action_throttle
   WHERE user_id = _uid AND action = _action
   FOR UPDATE;

  IF _prev IS NOT NULL AND (now() - _prev) < make_interval(secs => _min_ms / 1000.0) THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.user_action_throttle(user_id, action, last_at)
  VALUES (_uid, _action, now())
  ON CONFLICT (user_id, action) DO UPDATE SET last_at = now();
END;
$$;

-- Patch sell_fish: add rate limit + audit log for large sales
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
  _audit_threshold bigint := 100000; -- log sales >= 100k coins
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF COALESCE(array_length(_fish_stock_ids, 1), 0) = 0 THEN RETURN 0; END IF;

  -- Rate limit: max 1 sale per 500ms per user
  PERFORM public._enforce_rate_limit('sell_fish', 500);

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
  SELECT COALESCE(SUM(unit_value * quantity), 0), COALESCE(SUM(quantity), 0)
    INTO _total, _qty_total
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
    SELECT COALESCE(coins, 0) INTO _coins_before FROM public.profiles WHERE id = _uid;
    PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
    SELECT COALESCE(coins, 0) INTO _coins_after FROM public.profiles WHERE id = _uid;

    -- Golden audit log for large sales
    IF _total >= _audit_threshold THEN
      INSERT INTO public.transaction_logs(
        user_id, kind, item_id, quantity, unit_price,
        total_amount, balance_before, balance_after, meta
      ) VALUES (
        _uid, 'sell_fish', NULL, _qty_total,
        CASE WHEN _qty_total > 0 THEN (_total / _qty_total) ELSE 0 END,
        _total, _coins_before, _coins_after,
        jsonb_build_object('sold_counts', _sold_counts, 'stock_ids_count', array_length(_fish_stock_ids,1))
      );
    END IF;
  END IF;

  RETURN _total;
END;
$function$;
