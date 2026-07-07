
-- 1) New pearl upgrade cost curve: 3/6/9/12/15 by 30-level bands.
--    Total 1→150 ≈ 1347 pearls (~9 months at 5 wins/day).
CREATE OR REPLACE FUNCTION public.dragon_pearl_upgrade_cost(_from_level integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE n int := _from_level;
BEGIN
  IF n IS NULL OR n < 1 OR n >= 150 THEN RETURN NULL; END IF;
  IF n <= 29  THEN RETURN 3;  END IF;
  IF n <= 59  THEN RETURN 6;  END IF;
  IF n <= 89  THEN RETURN 9;  END IF;
  IF n <= 119 THEN RETURN 12; END IF;
  RETURN 15;
END;
$function$;

-- 2) New attack / defense bonus curves (as integer percentage 0..500 / 0..250).
--    Formula: cap * (L/150)^1.85 — gradual with late-game acceleration.
CREATE OR REPLACE FUNCTION public.dragon_attack_bonus_pct(_level integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(_level,0) <= 0 THEN 0
    WHEN _level >= 150 THEN 500
    ELSE FLOOR(500.0 * power(_level::numeric / 150.0, 1.85))::int
  END;
$$;

CREATE OR REPLACE FUNCTION public.dragon_defense_bonus_pct(_level integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(_level,0) <= 0 THEN 0
    WHEN _level >= 150 THEN 250
    ELSE FLOOR(250.0 * power(_level::numeric / 150.0, 1.85))::int
  END;
$$;

-- 3) Daily arena pearl counter (5 wins/day cap, 1 pearl per win).
CREATE TABLE IF NOT EXISTS public.dragon_arena_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  wins int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
GRANT SELECT ON public.dragon_arena_daily TO authenticated;
GRANT ALL ON public.dragon_arena_daily TO service_role;
ALTER TABLE public.dragon_arena_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own row read" ON public.dragon_arena_daily;
CREATE POLICY "own row read" ON public.dragon_arena_daily
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4) Arena pearl grants: 1 pearl / win, capped at 5 wins per UTC day.
CREATE OR REPLACE FUNCTION public._arena_grant_pearls_on_win(_won boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _cur int;
BEGIN
  IF _uid IS NULL OR _won IS NOT TRUE THEN RETURN; END IF;

  INSERT INTO public.dragon_arena_daily(user_id, day, wins)
  VALUES (_uid, _today, 0)
  ON CONFLICT (user_id, day) DO NOTHING;

  SELECT wins INTO _cur FROM public.dragon_arena_daily
    WHERE user_id = _uid AND day = _today FOR UPDATE;

  IF _cur >= 5 THEN
    -- daily cap reached: still record the pvp win, no pearl
    INSERT INTO public.dragons(user_id, pvp_wins) VALUES (_uid, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET pvp_wins = public.dragons.pvp_wins + 1, updated_at = now();
    RETURN;
  END IF;

  UPDATE public.dragon_arena_daily
     SET wins = wins + 1, updated_at = now()
   WHERE user_id = _uid AND day = _today;

  INSERT INTO public.dragons(user_id, pearls, pvp_wins) VALUES (_uid, 1, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET pearls   = public.dragons.pearls   + 1,
        pvp_wins = public.dragons.pvp_wins + 1,
        updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.arena_award_pearls()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _cur int;
  _new int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;

  INSERT INTO public.dragon_arena_daily(user_id, day, wins)
  VALUES (_uid, _today, 0)
  ON CONFLICT (user_id, day) DO NOTHING;

  SELECT wins INTO _cur FROM public.dragon_arena_daily
    WHERE user_id = _uid AND day = _today FOR UPDATE;

  IF _cur >= 5 THEN
    SELECT pearls INTO _new FROM public.dragons WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap',
                              'awarded', 0, 'pearls', COALESCE(_new, 0),
                              'wins_today', _cur, 'daily_max', 5);
  END IF;

  UPDATE public.dragon_arena_daily
     SET wins = wins + 1, updated_at = now()
   WHERE user_id = _uid AND day = _today;

  INSERT INTO public.dragons(user_id, pearls, pvp_wins) VALUES (_uid, 1, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET pearls   = public.dragons.pearls   + 1,
        pvp_wins = public.dragons.pvp_wins + 1,
        updated_at = now()
  RETURNING pearls INTO _new;

  RETURN jsonb_build_object('ok', true, 'pearls', _new, 'awarded', 1,
                            'wins_today', _cur + 1, 'daily_max', 5);
END;
$function$;
