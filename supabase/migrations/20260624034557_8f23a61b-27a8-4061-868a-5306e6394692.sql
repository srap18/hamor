-- Stage thresholds matching src/lib/dragon.ts DRAGON_STAGES dpRequired
CREATE OR REPLACE FUNCTION public.dragon_stage_for_dp(_dp bigint)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _dp >= 30000000 THEN 15
    WHEN _dp >= 12000000 THEN 14
    WHEN _dp >=  5000000 THEN 13
    WHEN _dp >=  2000000 THEN 12
    WHEN _dp >=   900000 THEN 11
    WHEN _dp >=   400000 THEN 10
    WHEN _dp >=   180000 THEN 9
    WHEN _dp >=    80000 THEN 8
    WHEN _dp >=    35000 THEN 7
    WHEN _dp >=    14000 THEN 6
    WHEN _dp >=     5000 THEN 5
    WHEN _dp >=     1800 THEN 4
    WHEN _dp >=      600 THEN 3
    WHEN _dp >=      200 THEN 2
    ELSE 1
  END;
$$;

-- Auto-promote stage on every read (and set hatched_at when leaving egg)
CREATE OR REPLACE FUNCTION public.get_or_init_dragon()
RETURNS public.dragons LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _d public.dragons;
  _target int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid;
  IF NOT FOUND THEN
    INSERT INTO public.dragons (user_id) VALUES (_uid) RETURNING * INTO _d;
  END IF;

  _target := public.dragon_stage_for_dp(COALESCE(_d.dp, 0));
  IF _target > COALESCE(_d.stage, 1) THEN
    UPDATE public.dragons
       SET stage = _target,
           hatched_at = COALESCE(hatched_at, CASE WHEN _target >= 2 THEN now() ELSE NULL END),
           updated_at = now()
     WHERE user_id = _uid
     RETURNING * INTO _d;
  END IF;

  RETURN _d;
END $$;

GRANT EXECUTE ON FUNCTION public.get_or_init_dragon() TO authenticated;

-- Backfill all existing dragons to the correct stage now
UPDATE public.dragons
   SET stage = public.dragon_stage_for_dp(COALESCE(dp, 0)),
       hatched_at = COALESCE(hatched_at, CASE WHEN public.dragon_stage_for_dp(COALESCE(dp, 0)) >= 2 THEN now() ELSE NULL END),
       updated_at = now()
 WHERE public.dragon_stage_for_dp(COALESCE(dp, 0)) > COALESCE(stage, 1);