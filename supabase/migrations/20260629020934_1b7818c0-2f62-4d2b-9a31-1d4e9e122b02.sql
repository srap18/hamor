-- 1) إزالة الفهرس الفريد الشامل الذي يسبب اندماج الشراء مع الصف المعيّن لسفينة.
DROP INDEX IF EXISTS public.inventory_user_item_uniq;

-- 2) تعويض اللاعبين: أي صف عليه طاقم مُعيّن لسفينة وكميته > 1
--    نُبقي الصف المعيّن بكمية 1 ونرحّل الفائض إلى صف "غير معيّن" (يظهر بالمخزن).
DO $$
DECLARE r record; v_extra bigint;
BEGIN
  FOR r IN
    SELECT id, user_id, item_type, item_id, quantity, meta
    FROM public.inventory
    WHERE quantity > 1
      AND meta IS NOT NULL
      AND (meta->>'assigned_ship_id') IS NOT NULL
  LOOP
    v_extra := r.quantity - 1;
    UPDATE public.inventory SET quantity = 1 WHERE id = r.id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (r.user_id, r.item_type, r.item_id, v_extra, NULL)
    ON CONFLICT (user_id, item_type, item_id)
      WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  END LOOP;
END $$;

-- 3) إصلاح open_lucky_box ليستخدم الفهرس الجزئي الصحيح بدل ON CONFLICT الشامل.
CREATE OR REPLACE FUNCTION public.open_lucky_box()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_settings record;
  v_market_level int;
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
  v_gems_left int;
  v_opens_count int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM set_config('app.server_write', 'on', true);

  SELECT * INTO v_settings FROM public.lucky_box_settings LIMIT 1;
  IF v_settings IS NULL OR v_settings.enabled = false THEN RAISE EXCEPTION 'lucky_box_disabled'; END IF;

  SELECT COALESCE(level, 1) INTO v_market_level FROM public.user_market WHERE user_id = v_user;
  IF COALESCE(v_market_level, 1) < 6 THEN RAISE EXCEPTION 'market_level_too_low'; END IF;

  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_settings.cost_gems THEN RAISE EXCEPTION 'not_enough_gems'; END IF;

  UPDATE public.profiles SET gems = COALESCE(gems, 0) - v_settings.cost_gems WHERE id = v_user;

  v_roll := random() * GREATEST(1, v_settings.pct_common + v_settings.pct_rare + v_settings.pct_legendary);
  IF v_roll < v_settings.pct_legendary THEN v_rarity := 'legendary';
  ELSIF v_roll < v_settings.pct_legendary + v_settings.pct_rare THEN v_rarity := 'rare';
  ELSE v_rarity := 'common'; END IF;

  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight
  FROM public.lucky_box_prizes WHERE rarity = v_rarity::public.lucky_box_rarity AND active = true;
  IF v_total_weight <= 0 THEN
    v_rarity := 'common';
    SELECT COALESCE(SUM(weight), 0) INTO v_total_weight
    FROM public.lucky_box_prizes WHERE rarity = v_rarity::public.lucky_box_rarity AND active = true;
  END IF;
  IF v_total_weight <= 0 THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;

  v_pick := random() * v_total_weight;
  FOR v_prize IN
    SELECT * FROM public.lucky_box_prizes
    WHERE rarity = v_rarity::public.lucky_box_rarity AND active = true ORDER BY id
  LOOP
    v_acc := v_acc + v_prize.weight;
    IF v_pick <= v_acc THEN EXIT; END IF;
  END LOOP;

  IF v_prize.prize_type = 'coins' THEN
    UPDATE public.profiles SET coins = COALESCE(coins, 0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'gems' THEN
    UPDATE public.profiles SET gems = COALESCE(gems, 0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'rubies' THEN
    UPDATE public.profiles SET rubies = COALESCE(rubies, 0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'xp' THEN
    UPDATE public.profiles SET xp = COALESCE(xp, 0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'dragon_equipment' THEN
    v_eq_stats := CASE v_prize.item_id
      WHEN 'common'    THEN jsonb_build_object('attack_pct', 5, 'crit', 0)
      WHEN 'rare'      THEN jsonb_build_object('attack_pct', 15, 'crit', 5)
      WHEN 'epic'      THEN jsonb_build_object('attack_pct', 25, 'crit', 10)
      WHEN 'legendary' THEN jsonb_build_object('attack_pct', 35, 'crit', 15, 'free_strike', true)
      WHEN 'divine'    THEN jsonb_build_object('attack_pct', 50, 'crit', 20, 'free_strike', true, 'continuous', true)
      WHEN 'fatak'     THEN jsonb_build_object('attack_pct', 75, 'crit', 30, 'free_strike', true, 'continuous', true, 'deadly', true)
      ELSE jsonb_build_object('attack_pct', 5)
    END;
    v_eq_name := CASE v_prize.item_type
      WHEN 'weapon' THEN CASE v_prize.item_id
        WHEN 'common' THEN 'سيف برونزي' WHEN 'rare' THEN 'سيف فضي مشتعل'
        WHEN 'epic' THEN 'نصل العاصفة' WHEN 'legendary' THEN 'سيف ملك التنانين'
        WHEN 'divine' THEN 'النصل الأبدي 🔱' WHEN 'fatak' THEN 'النصل الفتّاك 🩸' END
      WHEN 'armor' THEN CASE v_prize.item_id
        WHEN 'common' THEN 'درع جلدي' WHEN 'rare' THEN 'درع حديدي مُعزز'
        WHEN 'epic' THEN 'درع السماء' WHEN 'legendary' THEN 'درع التنين الذهبي'
        WHEN 'divine' THEN 'درع الأبدية 🔱' WHEN 'fatak' THEN 'درع الفتك 🩸' END
      ELSE CASE v_prize.item_id
        WHEN 'common' THEN 'تميمة عين' WHEN 'rare' THEN 'تميمة الياقوت'
        WHEN 'epic' THEN 'تميمة الرعد' WHEN 'legendary' THEN 'تميمة العنقاء'
        WHEN 'divine' THEN 'تميمة الأبدية 🔱' WHEN 'fatak' THEN 'تميمة الفتك 🩸' END
    END;
    INSERT INTO public.dragon_equipment(user_id, slot, rarity, name, stats)
    VALUES (v_user, v_prize.item_type, v_prize.item_id, COALESCE(v_eq_name, 'معدة تنين'), v_eq_stats);
  ELSIF v_prize.prize_type = 'item' THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
    VALUES (v_user, v_prize.item_type, v_prize.item_id, v_prize.amount, NULL)
    ON CONFLICT (user_id, item_type, item_id)
      WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  END IF;

  INSERT INTO public.lucky_box_opens (user_id, prize_id, rarity, label, icon, prize_type, amount)
  VALUES (v_user, v_prize.id, v_rarity::public.lucky_box_rarity, v_prize.label, v_prize.icon, v_prize.prize_type, v_prize.amount);

  IF v_rarity IN ('rare', 'legendary') THEN
    INSERT INTO public.global_banners (kind, message, color, meta)
    VALUES ('lucky_box',
      'حصل لاعب على جائزة ' || CASE WHEN v_rarity = 'legendary' THEN 'نادرة جدًا 🔥' ELSE 'نادرة' END || ': ' || v_prize.label,
      CASE WHEN v_rarity = 'legendary' THEN 'red' ELSE 'blue' END,
      jsonb_build_object('user_id', v_user, 'rarity', v_rarity, 'prize_name', v_prize.label));
  END IF;

  SELECT COALESCE(gems, 0) INTO v_gems_left FROM public.profiles WHERE id = v_user;
  SELECT COUNT(*)::int INTO v_opens_count FROM public.lucky_box_opens WHERE user_id = v_user;

  v_result := jsonb_build_object('ok', true, 'rarity', v_rarity, 'prize_id', v_prize.id,
    'label', v_prize.label, 'icon', v_prize.icon, 'prize_type', v_prize.prize_type,
    'amount', v_prize.amount, 'gems_left', v_gems_left, 'opens_count', v_opens_count);
  RETURN v_result;
END;
$function$;

-- 4) إضافة فهرس لتسريع استعلام رسائل الدردشة الخاصة (recipient_id OR sender_id).
CREATE INDEX IF NOT EXISTS messages_recipient_created_idx
  ON public.messages (recipient_id, created_at DESC)
  WHERE recipient_id IS NOT NULL;