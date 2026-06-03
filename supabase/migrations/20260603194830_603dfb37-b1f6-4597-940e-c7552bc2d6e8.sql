
-- ============ World Boss ============
CREATE TABLE IF NOT EXISTS public.world_boss (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'وحش الأعماق',
  hp_max bigint NOT NULL DEFAULT 5000000,
  hp_current bigint NOT NULL DEFAULT 5000000,
  spawned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  defeated_at timestamptz,
  defeated_by uuid,
  loot_distributed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.world_boss TO authenticated, anon;
GRANT ALL ON public.world_boss TO service_role;
ALTER TABLE public.world_boss ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wb_select_all ON public.world_boss;
CREATE POLICY wb_select_all ON public.world_boss FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_world_boss_active ON public.world_boss (expires_at, defeated_at);

-- ============ Boss Hits ============
CREATE TABLE IF NOT EXISTS public.boss_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boss_id uuid NOT NULL,
  user_id uuid NOT NULL,
  total_damage bigint NOT NULL DEFAULT 0,
  hit_count int NOT NULL DEFAULT 0,
  loot_claimed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (boss_id, user_id)
);
GRANT SELECT ON public.boss_hits TO authenticated, anon;
GRANT ALL ON public.boss_hits TO service_role;
ALTER TABLE public.boss_hits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bh_select_all ON public.boss_hits;
CREATE POLICY bh_select_all ON public.boss_hits FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_boss_hits_lookup ON public.boss_hits (boss_id, total_damage DESC);

-- ============ Arena Scores (weekly) ============
CREATE TABLE IF NOT EXISTS public.arena_scores (
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  score bigint NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);
GRANT SELECT ON public.arena_scores TO authenticated, anon;
GRANT ALL ON public.arena_scores TO service_role;
ALTER TABLE public.arena_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS as_select_all ON public.arena_scores;
CREATE POLICY as_select_all ON public.arena_scores FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_arena_week ON public.arena_scores (week_start, score DESC);

-- ============ Dragon claims (daily rockets + free strike cooldown) ============
CREATE TABLE IF NOT EXISTS public.dragon_claims (
  user_id uuid PRIMARY KEY,
  last_daily_rockets date,
  last_free_strike timestamptz
);
GRANT SELECT ON public.dragon_claims TO authenticated;
GRANT ALL ON public.dragon_claims TO service_role;
ALTER TABLE public.dragon_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_select_own ON public.dragon_claims;
CREATE POLICY dc_select_own ON public.dragon_claims FOR SELECT USING (auth.uid() = user_id);

-- ============ Equipment bonus helper ============
CREATE OR REPLACE FUNCTION public.player_attack_bonus(p_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'attack_pct', COALESCE(SUM((stats->>'attack_pct')::int), 0),
    'crit', COALESCE(MAX((stats->>'crit')::int), 0),
    'free_strike', bool_or(COALESCE((stats->>'free_strike')::boolean, false)),
    'continuous', bool_or(COALESCE((stats->>'continuous')::boolean, false)),
    'weapon_rarity', COALESCE(MAX(CASE WHEN slot = 'weapon' THEN
      CASE rarity WHEN 'divine' THEN 5 WHEN 'legendary' THEN 4 WHEN 'epic' THEN 3 WHEN 'rare' THEN 2 ELSE 1 END
    END), 0)
  )
  FROM dragon_equipment
  WHERE user_id = p_user AND equipped = true;
$$;
GRANT EXECUTE ON FUNCTION public.player_attack_bonus(uuid) TO authenticated;

-- ============ Get or spawn active boss ============
CREATE OR REPLACE FUNCTION public.get_active_boss()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_boss world_boss%ROWTYPE;
BEGIN
  -- find an active (alive and not expired) boss
  SELECT * INTO v_boss FROM world_boss
   WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
   ORDER BY spawned_at DESC LIMIT 1;

  -- if none, check most recent and spawn new if cooldown passed (48h after last spawn or immediate if none)
  IF v_boss.id IS NULL THEN
    PERFORM 1 FROM world_boss
      WHERE spawned_at > now() - interval '48 hours'
      ORDER BY spawned_at DESC LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO world_boss DEFAULT VALUES RETURNING * INTO v_boss;
    END IF;
  END IF;

  RETURN to_jsonb(v_boss);
END $$;
GRANT EXECUTE ON FUNCTION public.get_active_boss() TO authenticated, anon;

-- ============ Distribute boss loot ============
CREATE OR REPLACE FUNCTION public._distribute_boss_loot(p_boss_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec record;
  v_rank int := 0;
  v_roll numeric;
  v_rarity text;
  v_slot text;
  v_stats jsonb;
  v_name text;
BEGIN
  UPDATE world_boss SET loot_distributed = true WHERE id = p_boss_id AND loot_distributed = false;
  IF NOT FOUND THEN RETURN; END IF;

  FOR v_rec IN
    SELECT user_id, total_damage FROM boss_hits
     WHERE boss_id = p_boss_id ORDER BY total_damage DESC
  LOOP
    v_rank := v_rank + 1;
    v_roll := random();
    -- rank-boosted rarity (top 3 guaranteed rare+)
    IF v_rank <= 3 THEN
      IF v_roll < 0.01 THEN v_rarity := 'divine';
      ELSIF v_roll < 0.10 THEN v_rarity := 'legendary';
      ELSIF v_roll < 0.35 THEN v_rarity := 'epic';
      ELSE v_rarity := 'rare';
      END IF;
    ELSE
      IF v_roll < 0.01 THEN v_rarity := 'divine';
      ELSIF v_roll < 0.05 THEN v_rarity := 'legendary';
      ELSIF v_roll < 0.15 THEN v_rarity := 'epic';
      ELSIF v_roll < 0.40 THEN v_rarity := 'rare';
      ELSE v_rarity := 'common';
      END IF;
    END IF;

    v_slot := (ARRAY['weapon','armor','talisman'])[1 + floor(random() * 3)::int];
    v_stats := CASE v_rarity
      WHEN 'common' THEN jsonb_build_object('attack_pct',5,'crit',0)
      WHEN 'rare' THEN jsonb_build_object('attack_pct',15,'crit',5)
      WHEN 'epic' THEN jsonb_build_object('attack_pct',25,'crit',10)
      WHEN 'legendary' THEN jsonb_build_object('attack_pct',35,'crit',15,'free_strike',true)
      WHEN 'divine' THEN jsonb_build_object('attack_pct',50,'crit',20,'free_strike',true,'continuous',true)
    END;
    v_name := 'غنيمة البوس — ' || CASE v_slot
      WHEN 'weapon' THEN 'سيف'
      WHEN 'armor' THEN 'درع'
      ELSE 'تميمة' END;

    INSERT INTO dragon_equipment(user_id, slot, rarity, name, stats)
    VALUES (v_rec.user_id, v_slot, v_rarity, v_name, v_stats);

    -- bonus coins by rank
    UPDATE profiles SET coins = coins + GREATEST(5000, 50000 / v_rank)
      WHERE id = v_rec.user_id;

    INSERT INTO notifications(recipient_id, title, body, kind, meta)
    VALUES (
      v_rec.user_id,
      '🐉 سقط الوحش!',
      'حصلت على قطعة ' || v_rarity || ' لمساهمتك بالضرر',
      'reward',
      jsonb_build_object('rank', v_rank, 'rarity', v_rarity, 'slot', v_slot)
    );
  END LOOP;
END $$;

-- ============ Attack boss RPC ============
CREATE OR REPLACE FUNCTION public.attack_boss(p_use_free boolean DEFAULT false)
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
  v_last_strike timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO v_boss FROM world_boss
   WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
   ORDER BY spawned_at DESC LIMIT 1 FOR UPDATE;
  IF v_boss.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد بوس نشط');
  END IF;

  v_bonus := player_attack_bonus(v_user);
  v_atk_pct := COALESCE((v_bonus->>'attack_pct')::int, 0);
  v_crit_pct := COALESCE((v_bonus->>'crit')::int, 0);

  IF p_use_free THEN
    -- free dragon strike (legendary+ weapon, 30s cooldown)
    IF COALESCE((v_bonus->>'weapon_rarity')::int, 0) < 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'يحتاج سيف أسطوري+');
    END IF;
    INSERT INTO dragon_claims(user_id) VALUES (v_user)
      ON CONFLICT (user_id) DO NOTHING;
    SELECT last_free_strike INTO v_last_strike FROM dragon_claims WHERE user_id = v_user FOR UPDATE;
    IF v_last_strike IS NOT NULL AND v_last_strike > now() - interval '30 seconds' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ضربة التنين على كولداون');
    END IF;
    UPDATE dragon_claims SET last_free_strike = now() WHERE user_id = v_user;
    v_base_dmg := 5000;
  ELSE
    -- consume a rocket from inventory (any rarity)
    SELECT id INTO v_rocket_id FROM inventory
      WHERE user_id = v_user AND item_id IN ('rocket_small','rocket_medium','rocket_large','nuke')
      ORDER BY CASE item_id WHEN 'rocket_small' THEN 1 WHEN 'rocket_medium' THEN 2 WHEN 'rocket_large' THEN 3 ELSE 4 END
      LIMIT 1 FOR UPDATE;
    IF v_rocket_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'لا توجد صواريخ');
    END IF;
    -- get rocket damage by id
    SELECT CASE item_id
        WHEN 'rocket_small' THEN 800
        WHEN 'rocket_medium' THEN 4000
        WHEN 'rocket_large' THEN 18000
        WHEN 'nuke' THEN 70000
      END
    INTO v_base_dmg FROM inventory WHERE id = v_rocket_id;
    -- decrement / remove
    UPDATE inventory SET quantity = quantity - 1 WHERE id = v_rocket_id;
    DELETE FROM inventory WHERE id = v_rocket_id AND quantity <= 0;
  END IF;

  -- apply weapon bonus
  v_dmg := (v_base_dmg * (100 + v_atk_pct)) / 100;
  IF v_crit_pct > 0 AND random() * 100 < v_crit_pct THEN
    v_dmg := v_dmg * 2;
    v_crit := true;
  END IF;

  v_dmg := LEAST(v_dmg, v_boss.hp_current);
  UPDATE world_boss SET hp_current = hp_current - v_dmg WHERE id = v_boss.id
    RETURNING * INTO v_boss;

  -- track hit
  INSERT INTO boss_hits(boss_id, user_id, total_damage, hit_count, updated_at)
  VALUES (v_boss.id, v_user, v_dmg, 1, now())
  ON CONFLICT (boss_id, user_id) DO UPDATE SET
    total_damage = boss_hits.total_damage + EXCLUDED.total_damage,
    hit_count = boss_hits.hit_count + 1,
    updated_at = now();

  -- award DP
  PERFORM award_dragon_dp(v_dmg);

  IF v_boss.hp_current <= 0 THEN
    UPDATE world_boss SET defeated_at = now(), defeated_by = v_user WHERE id = v_boss.id;
    PERFORM _distribute_boss_loot(v_boss.id);
    v_killed := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'damage', v_dmg,
    'crit', v_crit,
    'boss_hp', v_boss.hp_current,
    'boss_hp_max', v_boss.hp_max,
    'killed', v_killed
  );
END $$;
GRANT EXECUTE ON FUNCTION public.attack_boss(boolean) TO authenticated;

-- ============ Free strike cooldown check ============
CREATE OR REPLACE FUNCTION public.free_strike_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_last timestamptz;
  v_rarity int;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  SELECT COALESCE((player_attack_bonus(v_user)->>'weapon_rarity')::int, 0) INTO v_rarity;
  IF v_rarity < 4 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_weapon');
  END IF;
  SELECT last_free_strike INTO v_last FROM dragon_claims WHERE user_id = v_user;
  IF v_last IS NULL OR v_last <= now() - interval '30 seconds' THEN
    RETURN jsonb_build_object('available', true, 'cooldown_until', NULL);
  END IF;
  RETURN jsonb_build_object('available', false, 'cooldown_until', v_last + interval '30 seconds');
END $$;
GRANT EXECUTE ON FUNCTION public.free_strike_status() TO authenticated;

-- ============ Daily free rockets from sword ============
CREATE OR REPLACE FUNCTION public.claim_daily_dragon_rockets()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rarity int;
  v_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_last date;
  v_rocket text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT COALESCE((player_attack_bonus(v_user)->>'weapon_rarity')::int, 0) INTO v_rarity;
  v_count := CASE v_rarity WHEN 5 THEN 5 WHEN 4 THEN 2 WHEN 3 THEN 1 ELSE 0 END;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يحتاج سيف ملحمي+');
  END IF;

  INSERT INTO dragon_claims(user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT last_daily_rockets INTO v_last FROM dragon_claims WHERE user_id = v_user FOR UPDATE;
  IF v_last IS NOT NULL AND v_last >= v_today THEN
    RETURN jsonb_build_object('ok', false, 'error', 'تم استلام صواريخ اليوم');
  END IF;
  UPDATE dragon_claims SET last_daily_rockets = v_today WHERE user_id = v_user;

  -- give rocket type based on weapon tier
  v_rocket := CASE v_rarity WHEN 5 THEN 'rocket_large' WHEN 4 THEN 'rocket_medium' ELSE 'rocket_small' END;

  INSERT INTO inventory(user_id, item_type, item_id, quantity)
  VALUES (v_user, 'weapon', v_rocket, v_count)
  ON CONFLICT DO NOTHING;
  -- merge if exists
  UPDATE inventory SET quantity = quantity + v_count
    WHERE user_id = v_user AND item_type = 'weapon' AND item_id = v_rocket
      AND id IN (
        SELECT id FROM inventory WHERE user_id = v_user AND item_type = 'weapon' AND item_id = v_rocket
        ORDER BY acquired_at DESC LIMIT 1
      );

  RETURN jsonb_build_object('ok', true, 'count', v_count, 'rocket', v_rocket);
END $$;
GRANT EXECUTE ON FUNCTION public.claim_daily_dragon_rockets() TO authenticated;

-- ============ Daily rockets availability ============
CREATE OR REPLACE FUNCTION public.daily_rockets_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rarity int;
  v_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_last date;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  SELECT COALESCE((player_attack_bonus(v_user)->>'weapon_rarity')::int, 0) INTO v_rarity;
  v_count := CASE v_rarity WHEN 5 THEN 5 WHEN 4 THEN 2 WHEN 3 THEN 1 ELSE 0 END;
  SELECT last_daily_rockets INTO v_last FROM dragon_claims WHERE user_id = v_user;
  RETURN jsonb_build_object(
    'available', (v_count > 0 AND (v_last IS NULL OR v_last < v_today)),
    'count', v_count,
    'tier', v_rarity
  );
END $$;
GRANT EXECUTE ON FUNCTION public.daily_rockets_status() TO authenticated;

-- ============ Award arena score (called from PvP attack) ============
CREATE OR REPLACE FUNCTION public.award_arena_score(p_score bigint, p_won boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
BEGIN
  IF v_user IS NULL OR p_score <= 0 THEN RETURN; END IF;
  INSERT INTO arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (v_user, v_week, p_score, CASE WHEN p_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    score = arena_scores.score + EXCLUDED.score,
    wins = arena_scores.wins + EXCLUDED.wins,
    updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION public.award_arena_score(bigint, boolean) TO authenticated;

-- spawn initial boss
INSERT INTO world_boss(name) SELECT 'وحش الأعماق' WHERE NOT EXISTS (
  SELECT 1 FROM world_boss WHERE defeated_at IS NULL AND expires_at > now()
);
