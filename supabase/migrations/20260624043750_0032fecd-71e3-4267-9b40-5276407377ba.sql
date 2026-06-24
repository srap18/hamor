
-- 1) Rebalance DP per boss weapon (was a flat +5000 per attack regardless of weapon)
CREATE OR REPLACE FUNCTION public.attack_boss_with(p_weapon text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_boss world_boss%ROWTYPE;
  v_next_boss world_boss%ROWTYPE;
  v_bonus jsonb;
  v_atk_pct int;
  v_crit_pct int;
  v_base_dmg bigint;
  v_dmg bigint;
  v_dp_gain int;
  v_crit boolean := false;
  v_rocket_id uuid;
  v_killed boolean := false;
  v_quota jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_weapon NOT IN ('rocket_small','rocket_medium','rocket_large','nuke') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سلاح غير معروف');
  END IF;

  v_quota := public._consume_boss_attack(v_user);
  IF NOT (v_quota->>'ok')::boolean THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'انتهت هجماتك اليومية على الوحش',
      'reset_at', v_quota->>'reset_at',
      'quota_exceeded', true
    );
  END IF;

  SELECT * INTO v_boss FROM public.world_boss
   WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
   ORDER BY spawned_at DESC LIMIT 1 FOR UPDATE;

  IF v_boss.id IS NULL THEN
    INSERT INTO public.world_boss DEFAULT VALUES RETURNING * INTO v_boss;
  END IF;

  v_bonus := public.player_attack_bonus(v_user);
  v_atk_pct := COALESCE((v_bonus->>'attack_pct')::int, 0);
  v_crit_pct := COALESCE((v_bonus->>'crit')::int, 0);

  SELECT id INTO v_rocket_id FROM public.inventory
    WHERE user_id = v_user AND item_id = p_weapon
    LIMIT 1 FOR UPDATE;
  IF v_rocket_id IS NULL THEN
    UPDATE public.boss_attack_quota SET hits_used = GREATEST(0, hits_used - 1) WHERE user_id = v_user;
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد لديك هذا الصاروخ');
  END IF;

  v_base_dmg := CASE p_weapon
    WHEN 'rocket_small'  THEN 800
    WHEN 'rocket_medium' THEN 4000
    WHEN 'rocket_large'  THEN 18000
    WHEN 'nuke'          THEN 70000
  END;

  -- DP awarded per weapon (long-term curve; 1 nuke = 1000 DP).
  v_dp_gain := CASE p_weapon
    WHEN 'rocket_small'  THEN 50
    WHEN 'rocket_medium' THEN 200
    WHEN 'rocket_large'  THEN 600
    WHEN 'nuke'          THEN 1000
  END;

  UPDATE public.inventory SET quantity = quantity - 1 WHERE id = v_rocket_id;
  DELETE FROM public.inventory WHERE id = v_rocket_id AND quantity <= 0;

  v_dmg := (v_base_dmg * (100 + v_atk_pct)) / 100;
  IF v_crit_pct > 0 AND random() * 100 < v_crit_pct THEN
    v_dmg := v_dmg * 2;
    v_crit := true;
  END IF;
  v_dmg := LEAST(v_dmg, v_boss.hp_current);

  UPDATE public.world_boss SET hp_current = hp_current - v_dmg WHERE id = v_boss.id
    RETURNING * INTO v_boss;

  INSERT INTO public.boss_hits(boss_id, user_id, total_damage, hit_count, updated_at)
  VALUES (v_boss.id, v_user, v_dmg, 1, now())
  ON CONFLICT (boss_id, user_id) DO UPDATE SET
    total_damage = public.boss_hits.total_damage + EXCLUDED.total_damage,
    hit_count = public.boss_hits.hit_count + 1,
    updated_at = now();

  INSERT INTO public.dragons(user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.dragons
    SET dp = dp + v_dp_gain,
        total_boss_damage = total_boss_damage + v_dmg,
        updated_at = now()
    WHERE user_id = v_user;

  -- Promote stage based on new (much higher) thresholds. Never demote.
  UPDATE public.dragons
    SET stage = GREATEST(stage, public.dragon_stage_for_dp(dp)),
        updated_at = now()
    WHERE user_id = v_user;

  IF v_boss.hp_current <= 0 THEN
    UPDATE public.world_boss SET defeated_at = now(), defeated_by = v_user WHERE id = v_boss.id;
    PERFORM public._distribute_boss_loot(v_boss.id);
    INSERT INTO public.world_boss DEFAULT VALUES RETURNING * INTO v_next_boss;
    v_killed := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'weapon', p_weapon,
    'damage', v_dmg, 'crit', v_crit,
    'boss_hp', v_boss.hp_current, 'boss_hp_max', v_boss.hp_max,
    'killed', v_killed,
    'next_boss', CASE WHEN v_killed THEN to_jsonb(v_next_boss) ELSE NULL END,
    'dp_gain', v_dp_gain,
    'attacks_remaining', (v_quota->>'remaining')::int
  );
END $function$;

-- 2) Sync the stage thresholds with src/lib/dragon.ts DRAGON_STAGES.
CREATE OR REPLACE FUNCTION public.dragon_stage_for_dp(_dp bigint)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _dp >= 30600000 THEN 15
    WHEN _dp >= 18600000 THEN 14
    WHEN _dp >= 11600000 THEN 13
    WHEN _dp >=  7600000 THEN 12
    WHEN _dp >=  5100000 THEN 11
    WHEN _dp >=  3600000 THEN 10
    WHEN _dp >=  2600000 THEN 9
    WHEN _dp >=  1900000 THEN 8
    WHEN _dp >=  1400000 THEN 7
    WHEN _dp >=  1000000 THEN 6
    WHEN _dp >=   650000 THEN 5
    WHEN _dp >=   350000 THEN 4
    WHEN _dp >=   150000 THEN 3
    WHEN _dp >=    50000 THEN 2
    ELSE 1
  END;
$$;

-- 3) Also update the legacy award_dragon_dp (used by other paths) to the new thresholds.
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

  -- Tuned for the new long-term curve: roughly 1 DP per 70 boss damage on nuke
  -- (1 nuke = 70k dmg → 1000 DP). Eternal sword keeps a 1.5× boost.
  IF v_has_eternal_sword THEN
    v_dp_gain := (p_damage * 3) / (70 * 2);
  ELSE
    v_dp_gain := p_damage / 70;
  END IF;

  IF v_dp_gain < 1 THEN v_dp_gain := 0; END IF;

  UPDATE dragons SET
    dp = dp + v_dp_gain,
    total_boss_damage = total_boss_damage + p_damage,
    updated_at = now()
  WHERE user_id = v_user
  RETURNING * INTO v_dragon;

  v_new_stage := public.dragon_stage_for_dp(v_dragon.dp);

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
