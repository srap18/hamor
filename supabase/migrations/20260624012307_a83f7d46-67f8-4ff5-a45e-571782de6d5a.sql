
-- Tighten dragon upgrades: slower DP gain + much higher stage thresholds (late game).
-- Existing players keep their DP and never get demoted; next stage just takes longer.

CREATE OR REPLACE FUNCTION public.award_dragon_dp(p_damage bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_dragon dragons%ROWTYPE;
  v_has_eternal_sword boolean;
  v_dp_gain bigint;
  v_new_stage int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_damage IS NULL OR p_damage <= 0 THEN
    RETURN jsonb_build_object('dp_gain', 0);
  END IF;

  INSERT INTO dragons(user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_dragon FROM dragons WHERE user_id = v_user FOR UPDATE;

  SELECT EXISTS(
    SELECT 1 FROM dragon_equipment
    WHERE user_id = v_user AND slot = 'weapon'
      AND equipped = true AND rarity = 'divine'
  ) INTO v_has_eternal_sword;

  -- 4× slower than before. Eternal sword keeps a 1.5× boost.
  IF v_has_eternal_sword THEN
    v_dp_gain := (p_damage * 3) / 8000;   -- 1 DP per ~2,667 damage
  ELSE
    v_dp_gain := p_damage / 4000;          -- 1 DP per 4,000 damage
  END IF;

  IF v_dp_gain < 1 THEN v_dp_gain := 0; END IF;

  UPDATE dragons SET
    dp = dp + v_dp_gain,
    total_boss_damage = total_boss_damage + p_damage,
    updated_at = now()
  WHERE user_id = v_user
  RETURNING * INTO v_dragon;

  -- New (much harder) thresholds for stage progression.
  v_new_stage := CASE
    WHEN v_dragon.dp >= 30000000 THEN 15
    WHEN v_dragon.dp >= 12000000 THEN 14
    WHEN v_dragon.dp >= 5000000  THEN 13
    WHEN v_dragon.dp >= 2000000  THEN 12
    WHEN v_dragon.dp >= 900000   THEN 11
    WHEN v_dragon.dp >= 400000   THEN 10
    WHEN v_dragon.dp >= 180000   THEN 9
    WHEN v_dragon.dp >= 80000    THEN 8
    WHEN v_dragon.dp >= 35000    THEN 7
    WHEN v_dragon.dp >= 14000    THEN 6
    WHEN v_dragon.dp >= 5000     THEN 5
    WHEN v_dragon.dp >= 1800     THEN 4
    WHEN v_dragon.dp >= 600      THEN 3
    WHEN v_dragon.dp >= 200      THEN 2
    ELSE 1
  END;

  -- Never demote: only promote when the new stage is strictly higher.
  IF v_new_stage > v_dragon.stage THEN
    UPDATE dragons SET stage = v_new_stage, updated_at = now()
    WHERE user_id = v_user
    RETURNING * INTO v_dragon;
  END IF;

  RETURN jsonb_build_object(
    'dp_gain', v_dp_gain,
    'dp', v_dragon.dp,
    'stage', v_dragon.stage
  );
END;
$function$;

-- Keep dragon_overall_level in sync with the new thresholds.
CREATE OR REPLACE FUNCTION public.dragon_overall_level(_user_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _stage int;
  _dp bigint;
  _thresholds bigint[] := ARRAY[
    0, 200, 600, 1800, 5000, 14000, 35000, 80000,
    180000, 400000, 900000, 2000000, 5000000, 12000000, 30000000
  ];
  _base bigint;
  _next bigint;
  _span bigint;
  _rel bigint;
  _sub int;
BEGIN
  SELECT stage, dp INTO _stage, _dp FROM public.dragons WHERE user_id = _user_id;
  IF _stage IS NULL THEN RETURN 0; END IF;
  _stage := GREATEST(1, LEAST(15, _stage));
  IF _stage = 1 AND COALESCE(_dp,0) <= 0 THEN RETURN 0; END IF;
  IF _stage >= 15 THEN RETURN 150; END IF;
  _base := _thresholds[_stage];
  _next := _thresholds[_stage + 1];
  _span := GREATEST(1, _next - _base);
  _rel := GREATEST(0, COALESCE(_dp,0) - _base);
  _sub := LEAST(10, FLOOR((_rel::numeric / _span::numeric) * 10)::int);
  RETURN (_stage - 1) * 10 + GREATEST(1, _sub + 1);
END;
$$;
