
ALTER TABLE public.user_market_state
  ADD COLUMN IF NOT EXISTS rot_freeze_offset_seconds bigint NOT NULL DEFAULT 0;

-- Freeze: allow buying additional time while a freeze is already active (extend),
-- and when starting a new freeze after a previous one expired, roll the old span
-- into a persistent offset so already-earned freshness isn't lost.
CREATE OR REPLACE FUNCTION public.buy_market_freeze(_hours int)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _now timestamptz := now();
  _cur_started timestamptz;
  _cur_until timestamptz;
  _cur_offset bigint;
  _new_until timestamptz;
  _new_started timestamptz;
  _new_offset bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;

  UPDATE public.profiles
     SET gems = gems - _cost
   WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;

  SELECT ums.freeze_started_at, ums.freeze_until, COALESCE(ums.rot_freeze_offset_seconds, 0)
    INTO _cur_started, _cur_until, _cur_offset
    FROM public.user_market_state ums
   WHERE ums.user_id = _uid
   FOR UPDATE;

  IF _cur_until IS NOT NULL AND _cur_until > _now AND _cur_started IS NOT NULL THEN
    -- Active freeze: extend duration, keep start + offset
    _new_started := _cur_started;
    _new_until   := _cur_until + (_hours || ' hours')::interval;
    _new_offset  := COALESCE(_cur_offset, 0);
  ELSE
    -- Previous freeze expired (or none): roll its span into the offset, then start fresh
    _new_offset := COALESCE(_cur_offset, 0);
    IF _cur_started IS NOT NULL AND _cur_until IS NOT NULL AND _cur_until > _cur_started THEN
      _new_offset := _new_offset + GREATEST(0, EXTRACT(EPOCH FROM (_cur_until - _cur_started))::bigint);
    END IF;
    _new_started := _now;
    _new_until   := _now + (_hours || ' hours')::interval;
  END IF;

  INSERT INTO public.user_market_state(user_id, freeze_started_at, freeze_until, rot_freeze_offset_seconds, frozen_prices, updated_at)
  VALUES (_uid, _new_started, _new_until, _new_offset, '{}'::jsonb, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_started_at = EXCLUDED.freeze_started_at,
        freeze_until = EXCLUDED.freeze_until,
        rot_freeze_offset_seconds = EXCLUDED.rot_freeze_offset_seconds,
        updated_at = _now;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'market_rot_freeze', -_cost, 'gems',
          jsonb_build_object('hours', _hours, 'extended', (_cur_until IS NOT NULL AND _cur_until > _now)));

  RETURN _new_until;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_market_freeze(int) TO authenticated;

-- Quote: rot pauses during freeze, and after freeze expires it resumes from where it paused.
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
  _offset_seconds bigint := 0;
  _now timestamptz := now();
  _oldest_caught timestamptz;
  _hours numeric := 0;
  _available integer := 0;
  _max_override numeric;
  _unit_base numeric;
  _freeze_used_seconds numeric := 0;
  _elapsed_seconds numeric := 0;
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

  SELECT ums.freeze_until, ums.freeze_started_at, COALESCE(ums.rot_freeze_offset_seconds, 0)
    INTO _freeze_until, _freeze_started_at, _offset_seconds
    FROM public.user_market_state AS ums
   WHERE ums.user_id = _uid;

  SELECT MIN(fs.caught_at), COALESCE(SUM(fs.quantity), 0)::integer
    INTO _oldest_caught, _available
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _oldest_caught IS NULL OR _available <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  -- Freeze pauses the rot clock. Compute how many seconds of the current (or
  -- most recent) freeze window overlap with [oldest_caught, now], then add any
  -- previously rolled-over freeze time from earlier freeze cycles.
  IF _freeze_started_at IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > _freeze_started_at THEN
    _freeze_used_seconds := GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(_freeze_until, _now) - GREATEST(_freeze_started_at, _oldest_caught)
    )));
  END IF;

  _elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (_now - _oldest_caught)) - COALESCE(_offset_seconds, 0) - _freeze_used_seconds);
  _hours := _elapsed_seconds / 3600.0;
  rot := GREATEST(0.5, 1 - 0.01 * _hours);

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    _unit_base := GREATEST(_current_price, _max_override);
  ELSE
    _unit_base := _current_price;
  END IF;
  effective_unit_price := GREATEST(0.0001, _unit_base * rot);

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;

  RETURN NEXT;
END;
$function$;
