CREATE OR REPLACE FUNCTION public.daily_xp_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT 0 $$;

CREATE OR REPLACE FUNCTION public._mutate_currency(
  _user uuid,
  _coins bigint DEFAULT 0,
  _gems integer DEFAULT 0,
  _rubies integer DEFAULT 0,
  _xp integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cur record;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _scaled integer := 0;
  _today_count integer;
  _xp_delta integer := 0;
BEGIN
  SELECT coins, gems, rubies, xp, level, xp_today, xp_today_date
    INTO _cur FROM public.profiles WHERE id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins  + _coins  < 0 THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  IF _cur.gems   + _gems   < 0 THEN RAISE EXCEPTION 'insufficient gems'; END IF;
  IF _cur.rubies + _rubies < 0 THEN RAISE EXCEPTION 'insufficient rubies'; END IF;

  _xp_delta := COALESCE(_xp, 0);
  IF _xp_delta > 0 THEN
    _scaled := FLOOR(_xp_delta * public.xp_gain_scale(_cur.level))::integer;
    _xp_delta := GREATEST(0, _scaled);
    _today_count := CASE
      WHEN _cur.xp_today_date = _today THEN COALESCE(_cur.xp_today, 0)
      ELSE 0
    END;

    UPDATE public.profiles
       SET coins = coins + _coins,
           gems = gems + _gems,
           rubies = rubies + _rubies,
           xp = xp + _xp_delta,
           xp_today = LEAST(2147483647::bigint, _today_count::bigint + _xp_delta::bigint)::integer,
           xp_today_date = _today
     WHERE id = _user;
  ELSE
    UPDATE public.profiles
       SET coins = coins + _coins,
           gems = gems + _gems,
           rubies = rubies + _rubies,
           xp = GREATEST(0, xp + _xp_delta)
     WHERE id = _user;
  END IF;

  IF _coins <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _coins, 'coins', 'mutate');
  END IF;
  IF _gems <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _gems, 'gems', 'mutate');
  END IF;
  IF _rubies <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _rubies, 'rubies', 'mutate');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._mutate_currency(uuid, bigint, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mutate_currency(uuid, bigint, integer, integer, integer) TO service_role;

UPDATE public.profiles
SET skill_points = skill_points + GREATEST(
  level - 1 - (
    COALESCE(skill_points, 0) +
    COALESCE(skill_str, 0) +
    COALESCE(skill_def, 0) +
    COALESCE(skill_luck, 0) +
    COALESCE(skill_fish, 0) +
    COALESCE(skill_speed, 0)
  ),
  0
)
WHERE (
  COALESCE(skill_points, 0) +
  COALESCE(skill_str, 0) +
  COALESCE(skill_def, 0) +
  COALESCE(skill_luck, 0) +
  COALESCE(skill_fish, 0) +
  COALESCE(skill_speed, 0)
) < GREATEST(level - 1, 0);