
-- Auto-donate for Jumanji tribe non-donors in the last minute of the day (Asia/Riyadh)
CREATE OR REPLACE FUNCTION public.jumanji_auto_donate_missing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tribe_id uuid := 'e2ca34e3-f56b-44b2-827d-39ba6b943edb'; -- جومانجي
  _day_start timestamptz;
  _tribe_today bigint;
  _tribe_cap bigint := 100000;
  _per_user bigint := 10000;
  _remaining bigint;
  _amount bigint;
  _count int := 0;
  _total bigint := 0;
  _m record;
BEGIN
  _day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh';

  SELECT COALESCE(SUM(amount),0) INTO _tribe_today
    FROM public.tribe_donations
    WHERE tribe_id = _tribe_id AND created_at >= _day_start;

  _remaining := _tribe_cap - _tribe_today;
  IF _remaining <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'tribe_cap_reached');
  END IF;

  FOR _m IN
    SELECT tm.user_id
      FROM public.tribe_members tm
      WHERE tm.tribe_id = _tribe_id
        AND NOT EXISTS (
          SELECT 1 FROM public.tribe_donations td
           WHERE td.tribe_id = _tribe_id
             AND td.user_id = tm.user_id
             AND td.created_at >= _day_start
        )
  LOOP
    IF _remaining <= 0 THEN EXIT; END IF;
    _amount := LEAST(_per_user, _remaining);

    UPDATE public.tribes
       SET total_donations = COALESCE(total_donations,0) + _amount,
           treasure_coins  = COALESCE(treasure_coins,0)  + _amount
     WHERE id = _tribe_id;

    UPDATE public.tribe_members
       SET donation_coins = COALESCE(donation_coins,0) + _amount,
           last_donation_at = now()
     WHERE tribe_id = _tribe_id AND user_id = _m.user_id;

    INSERT INTO public.tribe_donations(tribe_id, user_id, amount)
      VALUES (_tribe_id, _m.user_id, _amount);

    _remaining := _remaining - _amount;
    _total := _total + _amount;
    _count := _count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'members_covered', _count, 'total_donated', _total);
END;
$$;

-- Scheduler: check every minute; only executes work in the final minute of the day (Asia/Riyadh)
CREATE OR REPLACE FUNCTION public.jumanji_auto_donate_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _now_local timestamptz := now() AT TIME ZONE 'Asia/Riyadh';
BEGIN
  IF EXTRACT(HOUR FROM _now_local)::int = 23
     AND EXTRACT(MINUTE FROM _now_local)::int = 59 THEN
    RETURN public.jumanji_auto_donate_missing();
  END IF;
  RETURN jsonb_build_object('ok', true, 'skipped', 'not_last_minute');
END;
$$;

REVOKE ALL ON FUNCTION public.jumanji_auto_donate_missing() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jumanji_auto_donate_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jumanji_auto_donate_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.jumanji_auto_donate_missing() TO service_role;

-- Schedule via pg_cron: run every minute, function self-gates to the last minute of the day.
DO $$
BEGIN
  PERFORM cron.unschedule('jumanji-auto-donate');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'jumanji-auto-donate',
  '59 23 * * *',  -- 23:59 UTC daily; function re-checks Asia/Riyadh time
  $$ SELECT public.jumanji_auto_donate_tick(); $$
);

-- Also run every minute so it fires exactly at 23:59 Asia/Riyadh regardless of UTC offset
DO $$
BEGIN
  PERFORM cron.unschedule('jumanji-auto-donate-minutely');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'jumanji-auto-donate-minutely',
  '* * * * *',
  $$ SELECT public.jumanji_auto_donate_tick(); $$
);
