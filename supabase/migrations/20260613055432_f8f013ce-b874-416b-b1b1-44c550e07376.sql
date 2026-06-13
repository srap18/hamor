-- ============ Daily boss attack quota ============
CREATE TABLE IF NOT EXISTS public.boss_attack_quota (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hits_used int NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.boss_attack_quota TO authenticated;
GRANT ALL ON public.boss_attack_quota TO service_role;

ALTER TABLE public.boss_attack_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS baq_select_own ON public.boss_attack_quota;
CREATE POLICY baq_select_own ON public.boss_attack_quota
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============ Constants ============
-- DAILY_LIMIT  = 5
-- DP_PER_HIT   = 5000
-- GEM_REFRESH  = 1000

-- ============ Helper: consume one boss attack, return remaining ============
CREATE OR REPLACE FUNCTION public._consume_boss_attack(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row boss_attack_quota%ROWTYPE;
BEGIN
  INSERT INTO boss_attack_quota(user_id) VALUES (p_user)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM boss_attack_quota WHERE user_id = p_user FOR UPDATE;

  -- auto-reset window
  IF v_row.reset_at <= now() THEN
    v_row.hits_used := 0;
    v_row.reset_at := now() + interval '24 hours';
  END IF;

  IF v_row.hits_used >= 5 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'remaining', 0,
      'reset_at', v_row.reset_at
    );
  END IF;

  UPDATE boss_attack_quota
    SET hits_used = v_row.hits_used + 1,
        reset_at  = v_row.reset_at,
        updated_at = now()
    WHERE user_id = p_user;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining', 5 - (v_row.hits_used + 1),
    'reset_at', v_row.reset_at
  );
END $$;

-- ============ Status RPC ============
CREATE OR REPLACE FUNCTION public.boss_attack_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row boss_attack_quota%ROWTYPE;
  v_remaining int;
  v_reset_at timestamptz;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('remaining', 0, 'limit', 5); END IF;
  SELECT * INTO v_row FROM boss_attack_quota WHERE user_id = v_user;
  IF v_row.user_id IS NULL OR v_row.reset_at <= now() THEN
    v_remaining := 5;
    v_reset_at := COALESCE(v_row.reset_at, now() + interval '24 hours');
  ELSE
    v_remaining := GREATEST(0, 5 - v_row.hits_used);
    v_reset_at := v_row.reset_at;
  END IF;
  RETURN jsonb_build_object(
    'remaining', v_remaining,
    'limit', 5,
    'reset_at', v_reset_at,
    'refresh_gem_cost', 1000
  );
END $$;
GRANT EXECUTE ON FUNCTION public.boss_attack_status() TO authenticated;

-- ============ Refresh attacks for 1000 gems ============
CREATE OR REPLACE FUNCTION public.refresh_boss_attacks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_gems int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT gems INTO v_gems FROM profiles WHERE id = v_user FOR UPDATE;
  IF v_gems IS NULL OR v_gems < 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'تحتاج 1000 جوهرة لتجديد الهجمات');
  END IF;

  UPDATE profiles SET gems = gems - 1000 WHERE id = v_user;

  INSERT INTO boss_attack_quota(user_id, hits_used, reset_at, updated_at)
  VALUES (v_user, 0, now() + interval '24 hours', now())
  ON CONFLICT (user_id) DO UPDATE
    SET hits_used = 0,
        reset_at  = now() + interval '24 hours',
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'remaining', 5, 'gems_left', v_gems - 1000);
END $$;
GRANT EXECUTE ON FUNCTION public.refresh_boss_attacks() TO authenticated;

-- ============ Patched attack_boss_with: enforce quota + fixed DP ============
CREATE OR REPLACE FUNCTION public.attack_boss_with(p_weapon text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_boss world_boss%ROWTYPE;
  v_bonus jsonb;
  v_atk_pct int;
  v_crit_pct int;
  v_base_dmg bigint;
  v_dmg bigint;
  v_crit boolean := false;
  v_rocket_id uuid;
  v_killed boolean := false;
  v_quota jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_weapon NOT IN ('rocket_small','rocket_medium','rocket_large','nuke') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سلاح غير معروف');
  END IF;

  -- enforce daily quota first (does not consume on failure)
  v_quota := _consume_boss_attack(v_user);
  IF NOT (v_quota->>'ok')::boolean THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'انتهت هجماتك اليومية على الوحش',
      'reset_at', v_quota->>'reset_at',
      'quota_exceeded', true
    );
  END IF;

  SELECT * INTO v_boss FROM world_boss
   WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
   ORDER BY spawned_at DESC LIMIT 1 FOR UPDATE;
  IF v_boss.id IS NULL THEN
    -- refund the consumed attack since there's no boss
    UPDATE boss_attack_quota SET hits_used = GREATEST(0, hits_used - 1) WHERE user_id = v_user;
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد بوس نشط');
  END IF;

  v_bonus := player_attack_bonus(v_user);
  v_atk_pct := COALESCE((v_bonus->>'attack_pct')::int, 0);
  v_crit_pct := COALESCE((v_bonus->>'crit')::int, 0);

  SELECT id INTO v_rocket_id FROM inventory
    WHERE user_id = v_user AND item_id = p_weapon
    LIMIT 1 FOR UPDATE;
  IF v_rocket_id IS NULL THEN
    UPDATE boss_attack_quota SET hits_used = GREATEST(0, hits_used - 1) WHERE user_id = v_user;
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد لديك هذا الصاروخ');
  END IF;

  v_base_dmg := CASE p_weapon
    WHEN 'rocket_small'  THEN 800
    WHEN 'rocket_medium' THEN 4000
    WHEN 'rocket_large'  THEN 18000
    WHEN 'nuke'          THEN 70000
  END;

  UPDATE inventory SET quantity = quantity - 1 WHERE id = v_rocket_id;
  DELETE FROM inventory WHERE id = v_rocket_id AND quantity <= 0;

  v_dmg := (v_base_dmg * (100 + v_atk_pct)) / 100;
  IF v_crit_pct > 0 AND random() * 100 < v_crit_pct THEN
    v_dmg := v_dmg * 2;
    v_crit := true;
  END IF;
  v_dmg := LEAST(v_dmg, v_boss.hp_current);

  UPDATE world_boss SET hp_current = hp_current - v_dmg WHERE id = v_boss.id
    RETURNING * INTO v_boss;

  INSERT INTO boss_hits(boss_id, user_id, total_damage, hit_count, updated_at)
  VALUES (v_boss.id, v_user, v_dmg, 1, now())
  ON CONFLICT (boss_id, user_id) DO UPDATE SET
    total_damage = boss_hits.total_damage + EXCLUDED.total_damage,
    hit_count = boss_hits.hit_count + 1,
    updated_at = now();

  -- Fixed +5000 DP per successful boss attack (harder leveling curve)
  INSERT INTO dragons(user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE dragons
    SET dp = dp + 5000,
        total_boss_damage = total_boss_damage + v_dmg,
        updated_at = now()
    WHERE user_id = v_user;

  IF v_boss.hp_current <= 0 THEN
    UPDATE world_boss SET defeated_at = now(), defeated_by = v_user WHERE id = v_boss.id;
    PERFORM _distribute_boss_loot(v_boss.id);
    v_killed := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'weapon', p_weapon,
    'damage', v_dmg, 'crit', v_crit,
    'boss_hp', v_boss.hp_current, 'boss_hp_max', v_boss.hp_max,
    'killed', v_killed,
    'dp_gain', 5000,
    'attacks_remaining', (v_quota->>'remaining')::int
  );
END $$;
GRANT EXECUTE ON FUNCTION public.attack_boss_with(text) TO authenticated;