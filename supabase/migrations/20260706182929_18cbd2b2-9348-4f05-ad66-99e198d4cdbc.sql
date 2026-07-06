
-- Tracking table for gold earned from fish sales during active gold events
CREATE TABLE IF NOT EXISTS public.tribe_fish_event_gold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.tribe_fish_events(id) ON DELETE CASCADE,
  tribe_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tfeg_event_tribe ON public.tribe_fish_event_gold(event_id, tribe_id);
CREATE INDEX IF NOT EXISTS idx_tfeg_event_user ON public.tribe_fish_event_gold(event_id, user_id);

GRANT SELECT ON public.tribe_fish_event_gold TO authenticated;
GRANT ALL ON public.tribe_fish_event_gold TO service_role;

ALTER TABLE public.tribe_fish_event_gold ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own event gold" ON public.tribe_fish_event_gold
  FOR SELECT TO authenticated USING (true);

-- Helper: record fish sale gold into any active gold event for the user's tribe
CREATE OR REPLACE FUNCTION public._record_fish_sale_gold(_uid uuid, _amount bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tribe uuid;
  _ev record;
BEGIN
  IF _uid IS NULL OR _amount IS NULL OR _amount <= 0 THEN RETURN; END IF;
  SELECT tribe_id INTO _tribe FROM public.profiles WHERE id = _uid;
  IF _tribe IS NULL THEN RETURN; END IF;

  FOR _ev IN
    SELECT id FROM public.tribe_fish_events
    WHERE active = true
      AND metric = 'gold'
      AND starts_at <= now()
      AND ends_at >= now()
  LOOP
    INSERT INTO public.tribe_fish_event_gold(event_id, tribe_id, user_id, amount)
    VALUES (_ev.id, _tribe, _uid, _amount);
  END LOOP;
END;
$$;

-- Patch sell_fish_by_qty (3-arg) to record sale gold
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
  DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught), updated_at = now();

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

-- Patch sell_fish (batch by stock ids)
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
    PERFORM public._record_fish_sale_gold(_uid, _total);
  END IF;

  RETURN _total;
END;
$function$;

-- Patch sell_fish_caught
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

  PERFORM public._record_fish_sale_gold(_uid, _earned);

  remaining := _remaining;
  coins_earned := _earned;
  new_coins := _new_coins;
  RETURN NEXT;
END;
$function$;

-- Update leaderboard to sum fish-sale gold from tracking table
CREATE OR REPLACE FUNCTION public.tribe_fish_event_leaderboard(p_event_id uuid)
 RETURNS TABLE(tribe_id uuid, tribe_name text, tribe_emblem text, tribe_banner text, members_count bigint, total_fish bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_metric text;
  v_starts timestamptz;
  v_ends   timestamptz;
BEGIN
  SELECT e.metric, e.starts_at, e.ends_at
    INTO v_metric, v_starts, v_ends
  FROM public.tribe_fish_events e WHERE e.id = p_event_id;

  IF v_metric IS NULL THEN
    RETURN;
  END IF;

  IF v_metric = 'gold' THEN
    RETURN QUERY
    WITH sums AS (
      SELECT g.tribe_id AS tid, SUM(g.amount)::bigint AS total
      FROM public.tribe_fish_event_gold g
      WHERE g.event_id = p_event_id
      GROUP BY g.tribe_id
    )
    SELECT
      t.id, t.name, t.emblem, t.banner,
      (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
      COALESCE(s.total, 0)::bigint
    FROM public.tribes t
    LEFT JOIN sums s ON s.tid = t.id
    WHERE COALESCE(s.total, 0) > 0
    ORDER BY COALESCE(s.total, 0) DESC, t.name ASC;
  ELSE
    RETURN QUERY
    WITH catches AS (
      SELECT cc.tribe_id AS tid, SUM(cc.qty)::bigint AS total
      FROM public.competition_catches cc
      WHERE cc.tribe_id IS NOT NULL
        AND cc.caught_at >= v_starts
        AND cc.caught_at <= v_ends
      GROUP BY cc.tribe_id
    )
    SELECT
      t.id, t.name, t.emblem, t.banner,
      (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
      COALESCE(c.total, 0)::bigint
    FROM public.tribes t
    LEFT JOIN catches c ON c.tid = t.id
    WHERE COALESCE(c.total, 0) > 0
    ORDER BY COALESCE(c.total, 0) DESC, t.name ASC;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tribe_fish_event_member_leaderboard(p_event_id uuid, p_tribe_id uuid)
 RETURNS TABLE(user_id uuid, username text, avatar_url text, total_fish bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_metric text;
  v_starts timestamptz;
  v_ends   timestamptz;
BEGIN
  SELECT e.metric, e.starts_at, e.ends_at
    INTO v_metric, v_starts, v_ends
  FROM public.tribe_fish_events e WHERE e.id = p_event_id;

  IF v_metric IS NULL THEN
    RETURN;
  END IF;

  IF v_metric = 'gold' THEN
    RETURN QUERY
    SELECT
      p.id,
      COALESCE(p.username, 'لاعب'),
      p.avatar_url,
      COALESCE(SUM(g.amount), 0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.tribe_fish_event_gold g
      ON g.user_id = p.id
     AND g.event_id = p_event_id
     AND g.tribe_id = p_tribe_id
    WHERE p.tribe_id = p_tribe_id
    GROUP BY p.id, p.username, p.avatar_url
    HAVING COALESCE(SUM(g.amount), 0) > 0
    ORDER BY total_fish DESC, p.username ASC
    LIMIT 50;
  ELSE
    RETURN QUERY
    SELECT
      p.id,
      COALESCE(p.username, 'لاعب'),
      p.avatar_url,
      COALESCE(SUM(cc.qty), 0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.competition_catches cc
      ON cc.user_id = p.id
     AND cc.caught_at >= v_starts
     AND cc.caught_at <= v_ends
    WHERE p.tribe_id = p_tribe_id
    GROUP BY p.id, p.username, p.avatar_url
    HAVING COALESCE(SUM(cc.qty), 0) > 0
    ORDER BY total_fish DESC, p.username ASC
    LIMIT 50;
  END IF;
END;
$function$;
