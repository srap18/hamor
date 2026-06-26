
-- 1) Make arena_award_pearls robust: create dragon row if missing
CREATE OR REPLACE FUNCTION public.arena_award_pearls()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _new int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  INSERT INTO public.dragons(user_id, pearls, pvp_wins)
  VALUES (_uid, 2, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET pearls = public.dragons.pearls + 2,
        pvp_wins = public.dragons.pvp_wins + 1,
        updated_at = now()
  RETURNING pearls INTO _new;
  RETURN jsonb_build_object('ok', true, 'pearls', _new, 'awarded', 2);
END;
$$;

-- 2) Boss award: ensure dragon row created if needed (already handled but unify)
CREATE OR REPLACE FUNCTION public.boss_award_pearls(_boss_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _new int; _inserted boolean := false;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  IF _boss_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_args'); END IF;

  INSERT INTO public.dragon_boss_pearl_claims(user_id, boss_id, pearls)
  VALUES (_uid, _boss_id, 20)
  ON CONFLICT (user_id, boss_id) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF NOT _inserted THEN
    SELECT pearls INTO _new FROM public.dragons WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed', 'pearls', COALESCE(_new, 0));
  END IF;

  INSERT INTO public.dragons(user_id, pearls)
  VALUES (_uid, 20)
  ON CONFLICT (user_id) DO UPDATE
    SET pearls = public.dragons.pearls + 20,
        updated_at = now()
  RETURNING pearls INTO _new;
  RETURN jsonb_build_object('ok', true, 'pearls', _new, 'awarded', 20);
END;
$$;

GRANT EXECUTE ON FUNCTION public.arena_award_pearls() TO authenticated;
GRANT EXECUTE ON FUNCTION public.boss_award_pearls(uuid) TO authenticated;

-- 3) Server-side auto-award inside attack_boss_with when boss is killed.
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
  v_pearl_inserted boolean := false;
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

  UPDATE public.dragons
    SET stage = GREATEST(stage, public.dragon_stage_for_dp(dp)),
        updated_at = now()
    WHERE user_id = v_user;

  IF v_boss.hp_current <= 0 THEN
    UPDATE public.world_boss SET defeated_at = now(), defeated_by = v_user WHERE id = v_boss.id;
    PERFORM public._distribute_boss_loot(v_boss.id);

    -- AUTO-AWARD 20 PEARLS to the killer (once per boss)
    INSERT INTO public.dragon_boss_pearl_claims(user_id, boss_id, pearls)
    VALUES (v_user, v_boss.id, 20)
    ON CONFLICT (user_id, boss_id) DO NOTHING;
    GET DIAGNOSTICS v_pearl_inserted = ROW_COUNT;
    IF v_pearl_inserted THEN
      UPDATE public.dragons SET pearls = pearls + 20, updated_at = now() WHERE user_id = v_user;
    END IF;

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
    'attacks_remaining', (v_quota->>'remaining')::int,
    'pearls_awarded', CASE WHEN v_killed AND v_pearl_inserted THEN 20 ELSE 0 END
  );
END $function$;

-- 4) Auto-award 2 pearls inside award_arena_score when _won = true
DO $do$
DECLARE _src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _src FROM pg_proc WHERE proname='award_arena_score' LIMIT 1;
  IF _src IS NULL THEN
    -- nothing to wrap; create a thin wrapper-free path is unnecessary
    RETURN;
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public._arena_grant_pearls_on_win(_won boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _won IS NOT TRUE THEN RETURN; END IF;
  INSERT INTO public.dragons(user_id, pearls, pvp_wins)
  VALUES (_uid, 2, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET pearls = public.dragons.pearls + 2,
        pvp_wins = public.dragons.pvp_wins + 1,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public._arena_grant_pearls_on_win(boolean) TO authenticated;

-- Trigger pearl award by wrapping award_arena_score via overload that delegates and then grants.
-- Simpler: redefine award_arena_score to call original logic + pearl grant. We re-create with logic equivalent: insert/upsert into arena_scores.
CREATE OR REPLACE FUNCTION public.award_arena_score(_score bigint, _week_start date DEFAULT NULL, _won boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ws date := COALESCE(_week_start, (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date));
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;

  INSERT INTO public.arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (_uid, _ws, GREATEST(0, _score), CASE WHEN _won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET score = public.arena_scores.score + GREATEST(0, EXCLUDED.score),
        wins  = public.arena_scores.wins + CASE WHEN _won THEN 1 ELSE 0 END,
        updated_at = now();

  IF _won THEN
    PERFORM public._arena_grant_pearls_on_win(true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'pearls_awarded', CASE WHEN _won THEN 2 ELSE 0 END);
END;
$$;
GRANT EXECUTE ON FUNCTION public.award_arena_score(bigint, date, boolean) TO authenticated;
