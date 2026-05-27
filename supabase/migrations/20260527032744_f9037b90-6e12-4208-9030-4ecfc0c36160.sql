
-- 1) Daily feed counter
ALTER TABLE public.player_daughter
  ADD COLUMN IF NOT EXISTS feed_count_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feed_day DATE;

-- 2) New 10-stage progression
CREATE OR REPLACE FUNCTION public._daughter_stage_for(_fed INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _fed >= 25000 THEN 10
    WHEN _fed >= 13000 THEN 9
    WHEN _fed >= 7000  THEN 8
    WHEN _fed >= 4000  THEN 7
    WHEN _fed >= 2500  THEN 6
    WHEN _fed >= 1500  THEN 5
    WHEN _fed >= 800   THEN 4
    WHEN _fed >= 350   THEN 3
    WHEN _fed >= 100   THEN 2
    ELSE 1
  END;
$$;

-- 3) Gem cost to advance from current stage → current+1
CREATE OR REPLACE FUNCTION public.daughter_gem_cost(_from_stage INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _from_stage
    WHEN 1 THEN 80
    WHEN 2 THEN 200
    WHEN 3 THEN 500
    WHEN 4 THEN 1200
    WHEN 5 THEN 2800
    WHEN 6 THEN 6000
    WHEN 7 THEN 13000
    WHEN 8 THEN 28000
    WHEN 9 THEN 60000
    ELSE NULL
  END;
$$;

-- 4) Feed with 10/day cap
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
  _to_feed uuid[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _fish_stock_ids IS NULL OR array_length(_fish_stock_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no fish provided';
  END IF;

  INSERT INTO public.player_daughter (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;

  -- Roll over the daily counter if a new day
  UPDATE public.player_daughter
    SET feed_count_today = CASE WHEN feed_day = _today THEN feed_count_today ELSE 0 END,
        feed_day = _today
    WHERE user_id = _uid;

  SELECT feed_count_today INTO _used_today FROM public.player_daughter WHERE user_id = _uid;
  _remaining := GREATEST(0, 10 - COALESCE(_used_today, 0));

  IF _remaining = 0 THEN
    RAISE EXCEPTION 'daily_limit_reached';
  END IF;

  -- Take only the first _remaining fish from the request (so the user doesn't
  -- accidentally overshoot — extras stay in stock).
  _to_feed := (_fish_stock_ids)[1:_remaining];

  SELECT COUNT(*)::int, COALESCE(SUM(GREATEST(1, (base_value/100)::int)), 0)::int
    INTO _count, _xp_gain
  FROM public.fish_stock
  WHERE id = ANY(_to_feed) AND user_id = _uid;

  IF _count = 0 THEN RAISE EXCEPTION 'no matching fish'; END IF;

  DELETE FROM public.fish_stock WHERE id = ANY(_to_feed) AND user_id = _uid;

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

-- 5) Level up using gems (one stage per call)
CREATE OR REPLACE FUNCTION public.upgrade_daughter_with_gems()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cur_stage INT;
  _cost INT;
  _user_gems INT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  INSERT INTO public.player_daughter (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;

  SELECT stage INTO _cur_stage FROM public.player_daughter WHERE user_id = _uid;
  IF _cur_stage >= 10 THEN RAISE EXCEPTION 'max_stage'; END IF;

  _cost := public.daughter_gem_cost(_cur_stage);
  IF _cost IS NULL THEN RAISE EXCEPTION 'no_cost'; END IF;

  SELECT gems INTO _user_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF COALESCE(_user_gems, 0) < _cost THEN RAISE EXCEPTION 'not_enough_gems'; END IF;

  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid;
  UPDATE public.player_daughter
    SET stage = _cur_stage + 1,
        updated_at = now()
    WHERE user_id = _uid;

  RETURN jsonb_build_object(
    'old_stage', _cur_stage,
    'new_stage', _cur_stage + 1,
    'gems_spent', _cost
  );
END $$;

GRANT EXECUTE ON FUNCTION public.upgrade_daughter_with_gems() TO authenticated;
GRANT EXECUTE ON FUNCTION public.daughter_gem_cost(INTEGER) TO authenticated, anon;
