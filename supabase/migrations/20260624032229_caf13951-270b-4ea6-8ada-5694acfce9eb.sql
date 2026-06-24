-- Fix Lucky Box rare/legendary banner insert and make global pity counting concurrency-safe
CREATE OR REPLACE FUNCTION public.open_lucky_box()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_settings record;
  v_gems int;
  v_roll numeric;
  v_rarity text;
  v_prize record;
  v_total_weight numeric;
  v_pick numeric;
  v_acc numeric := 0;
  v_eq_name text;
  v_eq_stats jsonb;
  v_result jsonb;
  v_global_count bigint;
  v_this_open bigint;
  v_pity boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO v_settings FROM public.lucky_box_settings LIMIT 1;
  IF v_settings IS NULL OR v_settings.enabled = false THEN RAISE EXCEPTION 'lucky_box_disabled'; END IF;

  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_settings.cost_gems THEN RAISE EXCEPTION 'not_enough_gems'; END IF;

  -- Keep milestone prizes exact even if multiple players open boxes at the same time.
  LOCK TABLE public.lucky_box_opens IN EXCLUSIVE MODE;

  UPDATE public.profiles SET gems = gems - v_settings.cost_gems WHERE id = v_user;

  SELECT COUNT(*) INTO v_global_count FROM public.lucky_box_opens;
  v_this_open := v_global_count + 1;

  IF v_this_open % 200 = 0 THEN
    v_rarity := 'legendary';
    v_pity := true;
  ELSIF v_this_open % 50 = 0 THEN
    v_rarity := 'rare';
    v_pity := true;
  ELSE
    v_roll := random() * GREATEST(1, v_settings.pct_common + v_settings.pct_rare + v_settings.pct_legendary);
    IF v_roll < v_settings.pct_legendary THEN v_rarity := 'legendary';
    ELSIF v_roll < v_settings.pct_legendary + v_settings.pct_rare THEN v_rarity := 'rare';
    ELSE v_rarity := 'common'; END IF;
  END IF;

  SELECT COALESCE(SUM(weight),0) INTO v_total_weight
  FROM public.lucky_box_prizes WHERE rarity = v_rarity::lucky_box_rarity AND active = true;

  IF v_total_weight <= 0 THEN
    v_rarity := 'common';
    SELECT COALESCE(SUM(weight),0) INTO v_total_weight
    FROM public.lucky_box_prizes WHERE rarity = v_rarity::lucky_box_rarity AND active = true;
  END IF;

  IF v_total_weight <= 0 THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;

  v_pick := random() * v_total_weight;
  FOR v_prize IN
    SELECT * FROM public.lucky_box_prizes WHERE rarity = v_rarity::lucky_box_rarity AND active = true ORDER BY id
  LOOP
    v_acc := v_acc + v_prize.weight;
    IF v_pick <= v_acc THEN EXIT; END IF;
  END LOOP;

  IF v_prize.id IS NULL THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;

  IF v_prize.prize_type = 'coins' THEN
    UPDATE public.profiles SET coins = COALESCE(coins,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'gems' THEN
    UPDATE public.profiles SET gems = COALESCE(gems,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'rubies' THEN
    UPDATE public.profiles SET rubies = COALESCE(rubies,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'xp' THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'dragon_equipment' THEN
    v_eq_stats := CASE v_prize.item_id
      WHEN 'common'    THEN jsonb_build_object('attack_pct',5,'crit',0)
      WHEN 'rare'      THEN jsonb_build_object('attack_pct',15,'crit',5)
      WHEN 'epic'      THEN jsonb_build_object('attack_pct',25,'crit',10)
      WHEN 'legendary' THEN jsonb_build_object('attack_pct',35,'crit',15,'free_strike',true)
      WHEN 'divine'    THEN jsonb_build_object('attack_pct',50,'crit',20,'free_strike',true,'continuous',true)
      ELSE jsonb_build_object('attack_pct',5) END;
    v_eq_name := CASE v_prize.item_type
      WHEN 'weapon' THEN CASE v_prize.item_id
        WHEN 'common' THEN 'سيف برونزي' WHEN 'rare' THEN 'سيف فضي مشتعل'
        WHEN 'epic' THEN 'نصل العاصفة' WHEN 'legendary' THEN 'سيف ملك التنانين'
        WHEN 'divine' THEN 'النصل الأبدي 🔱' END
      WHEN 'armor' THEN CASE v_prize.item_id
        WHEN 'common' THEN 'درع جلدي' WHEN 'rare' THEN 'درع حديدي مُعزز'
        WHEN 'epic' THEN 'درع السماء' WHEN 'legendary' THEN 'درع التنين الذهبي'
        WHEN 'divine' THEN 'درع الأبدية 🔱' END
      ELSE CASE v_prize.item_id
        WHEN 'common' THEN 'تميمة عين' WHEN 'rare' THEN 'تميمة الياقوت'
        WHEN 'epic' THEN 'تميمة الرعد' WHEN 'legendary' THEN 'تميمة العنقاء'
        WHEN 'divine' THEN 'تميمة الأبدية 🔱' END
    END;
    INSERT INTO public.dragon_equipment(user_id, slot, rarity, name, stats)
    VALUES (v_user, v_prize.item_type, v_prize.item_id, COALESCE(v_eq_name,'معدة'), v_eq_stats);
  ELSIF v_prize.prize_type = 'item' THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, v_prize.item_type, v_prize.item_id, v_prize.amount)
    ON CONFLICT (user_id, item_type, item_id) WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  ELSE
    RAISE EXCEPTION 'unsupported_prize_type: %', v_prize.prize_type;
  END IF;

  INSERT INTO public.lucky_box_opens (user_id, prize_id, rarity, label, icon, prize_type, amount)
  VALUES (v_user, v_prize.id, v_rarity::lucky_box_rarity, v_prize.label, v_prize.icon, v_prize.prize_type, v_prize.amount);

  IF v_rarity IN ('rare','legendary') THEN
    INSERT INTO public.global_banners (kind, message, emoji, title)
    VALUES (
      'lucky_box',
      CASE WHEN v_pity AND v_rarity='legendary' THEN 'الصندوق رقم ' || v_this_open::text || ' عالميًا — جائزة نادرة جدًا: '
           WHEN v_pity AND v_rarity='rare'      THEN 'الصندوق رقم ' || v_this_open::text || ' عالميًا — جائزة نادرة: '
           ELSE 'حصل لاعب على جائزة ' || CASE WHEN v_rarity='legendary' THEN 'نادرة جدًا' ELSE 'نادرة' END || ': '
      END || v_prize.label,
      CASE WHEN v_rarity='legendary' THEN '🎉🔥' ELSE '🎉💎' END,
      'صندوق الحظ'
    );
  END IF;

  v_result := jsonb_build_object('rarity', v_rarity, 'prize_id', v_prize.id, 'label', v_prize.label,
    'icon', v_prize.icon, 'prize_type', v_prize.prize_type, 'amount', v_prize.amount,
    'opens_count', (SELECT COUNT(*) FROM public.lucky_box_opens WHERE user_id = v_user),
    'global_open', v_this_open,
    'pity', v_pity,
    'gems_left', (SELECT gems FROM public.profiles WHERE id = v_user),
    'ok', true);
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.open_lucky_box() TO authenticated;

-- Always return/spawn an alive world boss immediately when the current one is gone.
CREATE OR REPLACE FUNCTION public.get_active_boss()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_boss world_boss%ROWTYPE;
BEGIN
  SELECT * INTO v_boss FROM public.world_boss
   WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
   ORDER BY spawned_at DESC LIMIT 1;

  IF v_boss.id IS NULL THEN
    INSERT INTO public.world_boss DEFAULT VALUES RETURNING * INTO v_boss;
  END IF;

  RETURN to_jsonb(v_boss);
END $$;

GRANT EXECUTE ON FUNCTION public.get_active_boss() TO authenticated, anon;

-- Boss attack limit remains 5, refresh price is now 200 gems.
CREATE OR REPLACE FUNCTION public.boss_attack_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row boss_attack_quota%ROWTYPE;
  v_remaining int;
  v_reset_at timestamptz;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('remaining', 0, 'limit', 5, 'refresh_gem_cost', 200); END IF;
  SELECT * INTO v_row FROM public.boss_attack_quota WHERE user_id = v_user;
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
    'refresh_gem_cost', 200
  );
END $$;

GRANT EXECUTE ON FUNCTION public.boss_attack_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_boss_attacks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_gems int;
  v_cost int := 200;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF v_gems IS NULL OR v_gems < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'تحتاج 200 جوهرة لتجديد الهجمات');
  END IF;

  UPDATE public.profiles SET gems = gems - v_cost WHERE id = v_user;

  INSERT INTO public.boss_attack_quota(user_id, hits_used, reset_at, updated_at)
  VALUES (v_user, 0, now() + interval '24 hours', now())
  ON CONFLICT (user_id) DO UPDATE
    SET hits_used = 0,
        reset_at  = now() + interval '24 hours',
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'remaining', 5, 'gems_left', v_gems - v_cost, 'cost', v_cost);
END $$;

GRANT EXECUTE ON FUNCTION public.refresh_boss_attacks() TO authenticated;

-- Spawn the next boss in the same attack that defeats the current boss.
CREATE OR REPLACE FUNCTION public.attack_boss_with(p_weapon text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_boss world_boss%ROWTYPE;
  v_next_boss world_boss%ROWTYPE;
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
    SET dp = dp + 5000,
        total_boss_damage = total_boss_damage + v_dmg,
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
    'dp_gain', 5000,
    'attacks_remaining', (v_quota->>'remaining')::int
  );
END $$;

GRANT EXECUTE ON FUNCTION public.attack_boss_with(text) TO authenticated;