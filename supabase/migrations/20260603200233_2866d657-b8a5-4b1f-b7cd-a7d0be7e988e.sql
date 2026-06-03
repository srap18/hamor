
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_weapon NOT IN ('rocket_small','rocket_medium','rocket_large','nuke') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سلاح غير معروف');
  END IF;

  SELECT * INTO v_boss FROM world_boss
   WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
   ORDER BY spawned_at DESC LIMIT 1 FOR UPDATE;
  IF v_boss.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد بوس نشط');
  END IF;

  v_bonus := player_attack_bonus(v_user);
  v_atk_pct := COALESCE((v_bonus->>'attack_pct')::int, 0);
  v_crit_pct := COALESCE((v_bonus->>'crit')::int, 0);

  SELECT id INTO v_rocket_id FROM inventory
    WHERE user_id = v_user AND item_id = p_weapon
    LIMIT 1 FOR UPDATE;
  IF v_rocket_id IS NULL THEN
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

  PERFORM award_dragon_dp(v_dmg);

  IF v_boss.hp_current <= 0 THEN
    UPDATE world_boss SET defeated_at = now(), defeated_by = v_user WHERE id = v_boss.id;
    PERFORM _distribute_boss_loot(v_boss.id);
    v_killed := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'weapon', p_weapon,
    'damage', v_dmg, 'crit', v_crit,
    'boss_hp', v_boss.hp_current, 'boss_hp_max', v_boss.hp_max,
    'killed', v_killed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.attack_boss_with(text) TO authenticated;
