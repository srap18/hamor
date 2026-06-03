
-- Dragon weapon shop, equipment ops, and DP award RPCs

-- ============ award DP from boss damage ============
CREATE OR REPLACE FUNCTION public.award_dragon_dp(p_damage bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- ensure dragon exists
  INSERT INTO dragons(user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_dragon FROM dragons WHERE user_id = v_user FOR UPDATE;

  -- equipped eternal sword => 1500 dmg = 1 DP (instead of 1000)
  SELECT EXISTS(
    SELECT 1 FROM dragon_equipment
    WHERE user_id = v_user AND slot = 'weapon'
      AND equipped = true AND rarity = 'divine'
  ) INTO v_has_eternal_sword;

  IF v_has_eternal_sword THEN
    v_dp_gain := (p_damage * 3) / 2000; -- ~1.5x rate
  ELSE
    v_dp_gain := p_damage / 1000;
  END IF;

  IF v_dp_gain < 1 THEN v_dp_gain := 0; END IF;

  UPDATE dragons SET
    dp = dp + v_dp_gain,
    total_boss_damage = total_boss_damage + p_damage,
    updated_at = now()
  WHERE user_id = v_user
  RETURNING * INTO v_dragon;

  -- advance stage if eligible (stage thresholds inline)
  v_new_stage := CASE
    WHEN v_dragon.dp >= 100000 THEN 10
    WHEN v_dragon.dp >= 50000  THEN 9
    WHEN v_dragon.dp >= 25000  THEN 8
    WHEN v_dragon.dp >= 12000  THEN 7
    WHEN v_dragon.dp >= 5000   THEN 6
    WHEN v_dragon.dp >= 2000   THEN 5
    WHEN v_dragon.dp >= 800    THEN 4
    WHEN v_dragon.dp >= 300    THEN 3
    WHEN v_dragon.dp >= 100    THEN 2
    ELSE 1
  END;

  IF v_new_stage > v_dragon.stage THEN
    UPDATE dragons SET stage = v_new_stage,
      hatched_at = CASE WHEN hatched_at IS NULL AND v_new_stage >= 2 THEN now() ELSE hatched_at END
    WHERE user_id = v_user;
    v_dragon.stage := v_new_stage;
  END IF;

  RETURN jsonb_build_object(
    'dp_gain', v_dp_gain,
    'dp_total', v_dragon.dp,
    'stage', v_dragon.stage
  );
END $$;

GRANT EXECUTE ON FUNCTION public.award_dragon_dp(bigint) TO authenticated;

-- ============ buy equipment ============
-- Pricing:
--  gold: common 50k, rare 250k (gold only goes up to rare)
--  gems: rare 3k, epic 9k, legendary 22k, divine 45k
CREATE OR REPLACE FUNCTION public.buy_dragon_equipment(
  p_slot text,
  p_rarity text,
  p_currency text -- 'coins' or 'gems'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cost_coins bigint := 0;
  v_cost_gems int := 0;
  v_name text;
  v_stats jsonb;
  v_have_coins bigint;
  v_have_gems int;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_slot NOT IN ('weapon','armor','talisman') THEN RAISE EXCEPTION 'bad slot'; END IF;
  IF p_rarity NOT IN ('common','rare','epic','legendary','divine') THEN RAISE EXCEPTION 'bad rarity'; END IF;

  IF p_currency = 'coins' THEN
    IF p_rarity = 'common' THEN v_cost_coins := 50000;
    ELSIF p_rarity = 'rare' THEN v_cost_coins := 250000;
    ELSE RAISE EXCEPTION 'الذهب يصل لـ نادر فقط';
    END IF;
  ELSIF p_currency = 'gems' THEN
    IF p_rarity = 'rare' THEN v_cost_gems := 3000;
    ELSIF p_rarity = 'epic' THEN v_cost_gems := 9000;
    ELSIF p_rarity = 'legendary' THEN v_cost_gems := 22000;
    ELSIF p_rarity = 'divine' THEN v_cost_gems := 45000;
    ELSE RAISE EXCEPTION 'الجواهر تبدأ من نادر';
    END IF;
  ELSE
    RAISE EXCEPTION 'bad currency';
  END IF;

  SELECT coins, gems INTO v_have_coins, v_have_gems FROM profiles WHERE id = v_user FOR UPDATE;
  IF v_cost_coins > 0 AND v_have_coins < v_cost_coins THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الذهب غير كافٍ');
  END IF;
  IF v_cost_gems > 0 AND v_have_gems < v_cost_gems THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الجواهر غير كافية');
  END IF;

  -- stats per rarity
  v_stats := CASE p_rarity
    WHEN 'common' THEN jsonb_build_object('attack_pct',5,'crit',0)
    WHEN 'rare' THEN jsonb_build_object('attack_pct',15,'crit',5)
    WHEN 'epic' THEN jsonb_build_object('attack_pct',25,'crit',10)
    WHEN 'legendary' THEN jsonb_build_object('attack_pct',35,'crit',15,'free_strike',true)
    WHEN 'divine' THEN jsonb_build_object('attack_pct',50,'crit',20,'free_strike',true,'continuous',true)
  END;

  v_name := CASE p_slot
    WHEN 'weapon' THEN CASE p_rarity
      WHEN 'common' THEN 'سيف برونزي'
      WHEN 'rare' THEN 'سيف فضي مشتعل'
      WHEN 'epic' THEN 'نصل العاصفة'
      WHEN 'legendary' THEN 'سيف ملك التنانين'
      WHEN 'divine' THEN 'النصل الأبدي 🔱' END
    WHEN 'armor' THEN CASE p_rarity
      WHEN 'common' THEN 'درع جلدي'
      WHEN 'rare' THEN 'درع حديدي مُعزز'
      WHEN 'epic' THEN 'درع السماء'
      WHEN 'legendary' THEN 'درع التنين الذهبي'
      WHEN 'divine' THEN 'درع الأبدية 🔱' END
    ELSE CASE p_rarity
      WHEN 'common' THEN 'تميمة عين'
      WHEN 'rare' THEN 'تميمة الياقوت'
      WHEN 'epic' THEN 'تميمة الرعد'
      WHEN 'legendary' THEN 'تميمة العنقاء'
      WHEN 'divine' THEN 'تميمة الأبدية 🔱' END
  END;

  -- deduct
  UPDATE profiles SET
    coins = coins - v_cost_coins,
    gems  = gems  - v_cost_gems
  WHERE id = v_user;

  INSERT INTO dragon_equipment(user_id, slot, rarity, name, stats)
  VALUES (v_user, p_slot, p_rarity, v_name, v_stats)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
END $$;

GRANT EXECUTE ON FUNCTION public.buy_dragon_equipment(text,text,text) TO authenticated;

-- ============ equip / unequip ============
CREATE OR REPLACE FUNCTION public.equip_dragon_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_slot text;
  v_was_equipped boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT slot, equipped INTO v_slot, v_was_equipped
    FROM dragon_equipment WHERE id = p_item_id AND user_id = v_user FOR UPDATE;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'not found'; END IF;

  IF v_was_equipped THEN
    UPDATE dragon_equipment SET equipped = false WHERE id = p_item_id;
    RETURN jsonb_build_object('equipped', false);
  ELSE
    UPDATE dragon_equipment SET equipped = false WHERE user_id = v_user AND slot = v_slot;
    UPDATE dragon_equipment SET equipped = true WHERE id = p_item_id;
    RETURN jsonb_build_object('equipped', true);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.equip_dragon_item(uuid) TO authenticated;

-- ============ upgrade rarity with gems ============
CREATE OR REPLACE FUNCTION public.upgrade_dragon_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rarity text;
  v_slot text;
  v_next text;
  v_cost int;
  v_have int;
  v_new_name text;
  v_new_stats jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT rarity, slot INTO v_rarity, v_slot
    FROM dragon_equipment WHERE id = p_item_id AND user_id = v_user FOR UPDATE;
  IF v_rarity IS NULL THEN RAISE EXCEPTION 'not found'; END IF;

  v_next := CASE v_rarity
    WHEN 'common' THEN 'rare'
    WHEN 'rare' THEN 'epic'
    WHEN 'epic' THEN 'legendary'
    WHEN 'legendary' THEN 'divine'
    ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'بالفعل في أعلى مستوى'; END IF;

  v_cost := CASE v_next
    WHEN 'rare' THEN 1500
    WHEN 'epic' THEN 6000
    WHEN 'legendary' THEN 15000
    WHEN 'divine' THEN 35000
  END;

  SELECT gems INTO v_have FROM profiles WHERE id = v_user FOR UPDATE;
  IF v_have < v_cost THEN RETURN jsonb_build_object('ok', false, 'error', 'جواهر غير كافية'); END IF;

  v_new_stats := CASE v_next
    WHEN 'rare' THEN jsonb_build_object('attack_pct',15,'crit',5)
    WHEN 'epic' THEN jsonb_build_object('attack_pct',25,'crit',10)
    WHEN 'legendary' THEN jsonb_build_object('attack_pct',35,'crit',15,'free_strike',true)
    WHEN 'divine' THEN jsonb_build_object('attack_pct',50,'crit',20,'free_strike',true,'continuous',true)
  END;

  UPDATE profiles SET gems = gems - v_cost WHERE id = v_user;
  UPDATE dragon_equipment
    SET rarity = v_next, stats = v_new_stats
    WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true, 'rarity', v_next, 'cost', v_cost);
END $$;

GRANT EXECUTE ON FUNCTION public.upgrade_dragon_item(uuid) TO authenticated;
