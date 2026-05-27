-- Fix: signed-in users couldn't update profiles (missing UPDATE grant) → selling fish didn't add coins
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Also ensure key tables have proper grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_daughter TO authenticated;
GRANT ALL ON public.player_daughter TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fish_caught TO authenticated;
GRANT ALL ON public.fish_caught TO service_role;

-- New RPC: feed daughter using fish_caught (the table the catching system actually writes to)
CREATE OR REPLACE FUNCTION public.feed_daughter_caught(_fish_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count int := 0;
  _xp_gain int := 0;
  _old_stage int; _new_stage int;
  _new_total int;
  _today DATE := (now() AT TIME ZONE 'UTC')::date;
  _used_today INT;
  _remaining INT;
  _fid text;
  _have int;
  _price numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _fish_ids IS NULL OR array_length(_fish_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no fish provided';
  END IF;

  INSERT INTO public.player_daughter (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;

  UPDATE public.player_daughter
    SET feed_count_today = CASE WHEN feed_day = _today THEN feed_count_today ELSE 0 END,
        feed_day = _today
    WHERE user_id = _uid;

  SELECT feed_count_today INTO _used_today FROM public.player_daughter WHERE user_id = _uid;
  _remaining := GREATEST(0, 10 - COALESCE(_used_today, 0));

  IF _remaining = 0 THEN RAISE EXCEPTION 'daily_limit_reached'; END IF;

  FOREACH _fid IN ARRAY _fish_ids[1:_remaining] LOOP
    SELECT quantity INTO _have FROM public.fish_caught
      WHERE user_id = _uid AND fish_id = _fid;
    IF _have IS NULL OR _have <= 0 THEN CONTINUE; END IF;

    -- Decrement / delete
    IF _have <= 1 THEN
      DELETE FROM public.fish_caught WHERE user_id = _uid AND fish_id = _fid;
    ELSE
      UPDATE public.fish_caught
        SET quantity = quantity - 1, updated_at = now()
        WHERE user_id = _uid AND fish_id = _fid;
    END IF;

    -- XP from live market price (fallback 1)
    SELECT current_price INTO _price FROM public.fish_market_prices WHERE fish_id = _fid;
    _xp_gain := _xp_gain + GREATEST(1, COALESCE(_price, 1)::int);
    _count := _count + 1;
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
END $function$;

REVOKE EXECUTE ON FUNCTION public.feed_daughter_caught(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_daughter_caught(text[]) TO authenticated;