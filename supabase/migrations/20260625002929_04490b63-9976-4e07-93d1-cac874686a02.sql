
-- 1) Fix award_arena_score: accept the parameter names the client sends
DROP FUNCTION IF EXISTS public.award_arena_score(bigint, boolean);
DROP FUNCTION IF EXISTS public.award_arena_score(bigint, date);

CREATE OR REPLACE FUNCTION public.award_arena_score(
  _score bigint,
  _week_start date DEFAULT NULL,
  _won boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_week date := COALESCE(_week_start, date_trunc('week', (now() AT TIME ZONE 'UTC'))::date);
  v_capped bigint;
  v_settings public.arena_settings%ROWTYPE;
  v_mult numeric := 1;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_today_dp int := 0;
  v_dp_grant int := 0;
  v_new_stage int;
  v_dragon record;
BEGIN
  IF v_user IS NULL OR _score <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- Must have hatched dragon
  IF NOT public.dragon_is_hatched(v_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_dragon');
  END IF;

  SELECT * INTO v_settings FROM public.arena_settings LIMIT 1;
  IF v_settings.id IS NOT NULL AND v_settings.enabled = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  IF v_settings.event_active
     AND (v_settings.event_ends_at IS NULL OR v_settings.event_ends_at > now()) THEN
    v_mult := COALESCE(v_settings.event_multiplier, 1);
  END IF;

  v_capped := LEAST(_score, 5000);
  v_capped := GREATEST(1, (v_capped * v_mult)::bigint);

  INSERT INTO arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (v_user, v_week, v_capped, CASE WHEN _won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    score = arena_scores.score + EXCLUDED.score,
    wins  = arena_scores.wins  + EXCLUDED.wins,
    updated_at = now();

  -- Grant small dragon DP on a WIN, capped per day
  IF _won THEN
    -- Count today's wins for cap
    SELECT COUNT(*)::int * 3 INTO v_today_dp
      FROM public.attacks
      WHERE attacker_id = v_user
        AND attacker_won = true
        AND created_at >= v_today::timestamptz;
    -- Simpler approach: lookup the daily counter via dragons.updated_at-based throttle table is overkill.
    -- Use a hard cap: limit DP grants to 30/day by checking dragon dp delta marker in a tiny throttle table.
    INSERT INTO public.user_action_throttle(user_id, action, last_at)
    VALUES (v_user, 'arena_dp_' || v_today::text, now())
    ON CONFLICT DO NOTHING;

    -- Count today's grants via a counter row in user_action_throttle (action_count_key)
    -- We use bot_action_log as a counter: 1 row per grant
    SELECT COUNT(*) INTO v_today_dp FROM public.bot_action_log
      WHERE user_id = v_user
        AND action = 'arena_dp_grant'
        AND created_at >= v_today::timestamptz;

    IF v_today_dp < 10 THEN
      v_dp_grant := 3;
      INSERT INTO public.bot_action_log(user_id, action, created_at)
      VALUES (v_user, 'arena_dp_grant', now());

      SELECT user_id, stage, dp INTO v_dragon FROM public.dragons WHERE user_id = v_user FOR UPDATE;
      IF v_dragon.user_id IS NOT NULL THEN
        UPDATE public.dragons SET dp = COALESCE(dp,0) + v_dp_grant, updated_at = now()
          WHERE user_id = v_user;
        -- Optional: bump stage if threshold passed (handled elsewhere via overallLevel client-side)
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'score', v_capped, 'won', _won, 'dp_granted', v_dp_grant);
END $function$;

GRANT EXECUTE ON FUNCTION public.award_arena_score(bigint, date, boolean) TO authenticated;

-- 2) Weapon Smelting RPC: merge two dragon equipment pieces for 1000 gems
CREATE OR REPLACE FUNCTION public.smelt_dragon_items(
  p_a_id uuid,
  p_b_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_cost int := 1000;
  v_gems int;
  v_a record;
  v_b record;
  v_rarity_order text[] := ARRAY['common','rare','epic','legendary','divine'];
  v_a_idx int;
  v_b_idx int;
  v_max_idx int;
  v_roll numeric;
  v_result_idx int;
  v_result_rarity text;
  v_outcome text;
  v_new_id uuid;
  v_new_name text;
  v_stats jsonb;
  v_attack int;
  v_crit int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_a_id = p_b_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يمكن دمج نفس القطعة مع نفسها');
  END IF;

  -- Lock items
  SELECT * INTO v_a FROM public.dragon_equipment
    WHERE id = p_a_id AND user_id = v_user FOR UPDATE;
  SELECT * INTO v_b FROM public.dragon_equipment
    WHERE id = p_b_id AND user_id = v_user FOR UPDATE;

  IF v_a.id IS NULL OR v_b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'القطع غير موجودة');
  END IF;

  IF v_a.slot <> v_b.slot THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب دمج قطع من نفس النوع');
  END IF;

  -- Check & deduct gems
  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'جواهر غير كافية (1000 جوهرة)');
  END IF;
  UPDATE public.profiles SET gems = gems - v_cost WHERE id = v_user;

  -- Compute rarity indices
  v_a_idx := array_position(v_rarity_order, v_a.rarity);
  v_b_idx := array_position(v_rarity_order, v_b.rarity);
  v_max_idx := GREATEST(v_a_idx, v_b_idx);

  -- Roll outcome
  v_roll := random();

  IF v_a_idx = v_b_idx THEN
    -- Same rarity: 55% upgrade, 30% same, 15% downgrade
    IF v_roll < 0.55 THEN
      v_result_idx := LEAST(v_a_idx + 1, 5);
      v_outcome := CASE WHEN v_result_idx > v_a_idx THEN 'upgrade' ELSE 'same' END;
    ELSIF v_roll < 0.85 THEN
      v_result_idx := v_a_idx;
      v_outcome := 'same';
    ELSE
      v_result_idx := GREATEST(v_a_idx - 1, 1);
      v_outcome := CASE WHEN v_result_idx < v_a_idx THEN 'downgrade' ELSE 'same' END;
    END IF;
  ELSE
    -- Different rarity: 35% upgrade-of-max, 45% max, 20% downgrade-of-max
    IF v_roll < 0.35 THEN
      v_result_idx := LEAST(v_max_idx + 1, 5);
      v_outcome := CASE WHEN v_result_idx > v_max_idx THEN 'upgrade' ELSE 'same' END;
    ELSIF v_roll < 0.80 THEN
      v_result_idx := v_max_idx;
      v_outcome := 'same';
    ELSE
      v_result_idx := GREATEST(v_max_idx - 1, 1);
      v_outcome := 'downgrade';
    END IF;
  END IF;

  v_result_rarity := v_rarity_order[v_result_idx];

  -- Stats by rarity (mirror shop tiers)
  v_attack := CASE v_result_rarity
    WHEN 'common' THEN 5
    WHEN 'rare' THEN 15
    WHEN 'epic' THEN 25
    WHEN 'legendary' THEN 35
    WHEN 'divine' THEN 50
  END;
  v_crit := CASE v_result_rarity
    WHEN 'common' THEN 0
    WHEN 'rare' THEN 5
    WHEN 'epic' THEN 10
    WHEN 'legendary' THEN 15
    WHEN 'divine' THEN 20
  END;
  v_stats := jsonb_build_object('attack_pct', v_attack, 'crit', v_crit);

  v_new_name := CASE v_a.slot
    WHEN 'weapon' THEN 'سلاح مصهور'
    WHEN 'armor' THEN 'درع مصهور'
    ELSE 'تميمة مصهورة'
  END;

  -- Delete sources
  DELETE FROM public.dragon_equipment WHERE id IN (p_a_id, p_b_id);

  -- Insert result
  INSERT INTO public.dragon_equipment(user_id, slot, rarity, name, stats, equipped)
  VALUES (v_user, v_a.slot, v_result_rarity, v_new_name, v_stats, false)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'rarity', v_result_rarity,
    'new_id', v_new_id,
    'gems_left', v_gems - v_cost
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.smelt_dragon_items(uuid, uuid) TO authenticated;
