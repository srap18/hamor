
CREATE OR REPLACE FUNCTION public.arena_dragon_overall_level(_stage int, _dp bigint)
RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  stages constant int[][] := ARRAY[
    ARRAY[1,0],ARRAY[2,200],ARRAY[3,600],ARRAY[4,1800],ARRAY[5,5000],
    ARRAY[6,14000],ARRAY[7,35000],ARRAY[8,80000],ARRAY[9,180000],ARRAY[10,400000],
    ARRAY[11,900000],ARRAY[12,2000000],ARRAY[13,5000000],ARRAY[14,12000000],ARRAY[15,30000000]
  ];
  form_idx int;
  base bigint;
  nxt bigint;
  span bigint;
  rel bigint;
  sub int;
BEGIN
  form_idx := GREATEST(1, LEAST(15, COALESCE(_stage,1)));
  IF form_idx = 1 AND COALESCE(_dp,0) <= 0 THEN RETURN 0; END IF;
  IF form_idx = 15 THEN RETURN 150; END IF;
  base := stages[form_idx][2];
  nxt  := stages[form_idx+1][2];
  span := GREATEST(1, nxt - base);
  rel  := GREATEST(0, COALESCE(_dp,0) - base);
  sub  := LEAST(10, FLOOR((rel::numeric / span::numeric) * 10)::int);
  RETURN (form_idx - 1) * 10 + GREATEST(1, sub + 1);
END $$;

CREATE OR REPLACE FUNCTION public.arena_dragon_duel(_opponent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_my_stage int; v_my_dp bigint;
  v_op_stage int; v_op_dp bigint;
  v_my_lvl int; v_op_lvl int;
  v_last timestamptz;
  v_p numeric;
  v_roll numeric;
  v_won boolean;
  v_score int;
  v_week date := date_trunc('week', now())::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _opponent IS NULL OR _opponent = v_user THEN RAISE EXCEPTION 'invalid opponent'; END IF;

  -- throttle: 10s
  SELECT updated_at INTO v_last FROM arena_scores WHERE user_id = v_user AND week_start = v_week;
  -- use a dedicated throttle row if exists
  PERFORM 1;
  IF EXISTS (SELECT 1 FROM user_action_throttle WHERE user_id = v_user AND action = 'arena_duel' AND last_at > now() - interval '10 seconds') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  SELECT stage, dp INTO v_my_stage, v_my_dp FROM dragons WHERE user_id = v_user;
  IF v_my_stage IS NULL THEN v_my_stage := 1; v_my_dp := 0; END IF;
  SELECT stage, dp INTO v_op_stage, v_op_dp FROM dragons WHERE user_id = _opponent;
  IF v_op_stage IS NULL THEN v_op_stage := 1; v_op_dp := 0; END IF;

  v_my_lvl := public.arena_dragon_overall_level(v_my_stage, v_my_dp);
  v_op_lvl := public.arena_dragon_overall_level(v_op_stage, v_op_dp);

  -- win probability: based on level diff, 10%..90%
  v_p := 0.5 + 0.03 * (v_my_lvl - v_op_lvl);
  v_p := GREATEST(0.10, LEAST(0.90, v_p));
  v_roll := random();
  v_won := v_roll < v_p;

  -- score: win 80 + bonus for tougher opponent; loss 10 (consolation)
  IF v_won THEN
    v_score := 80 + GREATEST(0, v_op_lvl - v_my_lvl) * 4;
    v_score := LEAST(v_score, 250);
  ELSE
    v_score := 10;
  END IF;

  INSERT INTO arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (v_user, v_week, v_score, CASE WHEN v_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    score = arena_scores.score + EXCLUDED.score,
    wins  = arena_scores.wins  + EXCLUDED.wins,
    updated_at = now();

  INSERT INTO user_action_throttle(user_id, action, last_at)
  VALUES (v_user, 'arena_duel', now())
  ON CONFLICT (user_id, action) DO UPDATE SET last_at = now();

  RETURN jsonb_build_object(
    'won', v_won,
    'my_level', v_my_lvl,
    'opp_level', v_op_lvl,
    'my_stage', v_my_stage,
    'opp_stage', v_op_stage,
    'score', v_score,
    'win_chance', round(v_p * 100)
  );
END $$;

REVOKE ALL ON FUNCTION public.arena_dragon_duel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arena_dragon_duel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.arena_dragon_overall_level(int, bigint) TO authenticated;
