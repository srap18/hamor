CREATE OR REPLACE FUNCTION public.claim_daily_login()
 RETURNS TABLE(day_index integer, coins_awarded bigint, gems_awarded integer, xp_awarded integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _streak int := 0;
  _last date;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _day int;
  _c bigint := 0; _g int := 0; _x int := 0;
  _rows int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Per-user transactional advisory lock — blocks concurrent claims from
  -- multiple tabs/devices even when no streak row exists yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':daily_login', 0));

  -- Ensure the streak row exists so the FOR UPDATE below actually locks it.
  INSERT INTO public.daily_login_streaks(user_id, current_streak, last_claim_date, total_claims)
    VALUES (_uid, 0, NULL, 0)
    ON CONFLICT (user_id) DO NOTHING;

  SELECT current_streak, last_claim_date INTO _streak, _last
    FROM public.daily_login_streaks WHERE user_id = _uid FOR UPDATE;

  IF _last = _today THEN RAISE EXCEPTION 'already claimed today'; END IF;

  IF _last IS NULL OR _last < _today - 1 THEN _streak := 1;
  ELSE _streak := _streak + 1; END IF;
  _day := ((_streak - 1) % 7) + 1;

  CASE _day
    WHEN 1 THEN _c := 500;
    WHEN 2 THEN _c := 1000; _x := 50;
    WHEN 3 THEN _c := 2000; _g := 2;
    WHEN 4 THEN _c := 3000; _x := 100;
    WHEN 5 THEN _c := 5000; _g := 5;
    WHEN 6 THEN _c := 8000; _x := 200; _g := 3;
    WHEN 7 THEN _c := 15000; _g := 10; _x := 500;
  END CASE;

  -- Atomically claim the day; if a concurrent tx already claimed today, abort.
  UPDATE public.daily_login_streaks
     SET current_streak = _streak,
         last_claim_date = _today,
         total_claims = total_claims + 1,
         updated_at = now()
   WHERE user_id = _uid
     AND (last_claim_date IS NULL OR last_claim_date < _today);
  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows = 0 THEN RAISE EXCEPTION 'already claimed today'; END IF;

  PERFORM public._mutate_currency(_uid, _c, _g, 0, _x);

  RETURN QUERY SELECT _day, _c, _g, _x;
END $function$;