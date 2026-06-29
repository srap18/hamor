
-- 1) Deactivate malformed prizes that crash open_lucky_box
UPDATE public.lucky_box_prizes
SET active = false
WHERE active = true
  AND (
    (prize_type = 'dragon_equipment' AND (item_id IS NULL OR item_id NOT IN ('common','rare','epic','legendary','divine','fatak')))
    OR (prize_type = 'item' AND (item_id IS NULL OR item_type IS NULL))
    OR (prize_type IN ('coins','gems','rubies','xp') AND COALESCE(amount,0) <= 0)
  );

-- 2) Make open_lucky_box defensive: skip broken prizes (re-pick), and wrap
--    the per-prize side-effect insert so a single corrupt row can never
--    block the whole open call.
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
  v_acc numeric;
  v_eq_name text;
  v_eq_stats jsonb;
  v_result jsonb;
  v_gems_left int;
  v_opens_count int;
  v_attempts int := 0;
  v_valid boolean;
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

  -- Try up to 5 rarities/picks until we land on a usable prize.
  LOOP
    v_attempts := v_attempts + 1;
    EXIT WHEN v_attempts > 5;

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
    v_acc := 0;
    v_prize := NULL;
    FOR v_prize IN
      SELECT * FROM public.lucky_box_prizes
      WHERE rarity = v_rarity::public.lucky_box_rarity AND active = true ORDER BY id
    LOOP
      v_acc := v_acc + v_prize.weight;
      IF v_pick <= v_acc THEN EXIT; END IF;
    END LOOP;

    -- Validate prize shape so we never crash on bad data.
    v_valid := CASE
      WHEN v_prize.prize_type IN ('coins','gems','rubies','xp') THEN COALESCE(v_prize.amount,0) > 0
      WHEN v_prize.prize_type = 'dragon_equipment' THEN
        v_prize.item_id IN ('common','rare','epic','legendary','divine','fatak')
        AND v_prize.item_type IN ('weapon','armor','talisman')
      WHEN v_prize.prize_type = 'item' THEN
        v_prize.item_id IS NOT NULL AND v_prize.item_type IS NOT NULL AND COALESCE(v_prize.amount,0) > 0
      ELSE false
    END;
    EXIT WHEN v_valid;
  END LOOP;

  IF NOT v_valid THEN
    -- Refund and bail rather than leaving the player charged.
    UPDATE public.profiles SET gems = COALESCE(gems, 0) + v_settings.cost_gems WHERE id = v_user;
    RAISE EXCEPTION 'no_prizes_configured';
  END IF;

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
    BEGIN
      INSERT INTO public.global_banners (kind, message, color, meta)
      VALUES ('lucky_box',
        'حصل لاعب على جائزة ' || CASE WHEN v_rarity = 'legendary' THEN 'نادرة جدًا 🔥' ELSE 'نادرة' END || ': ' || v_prize.label,
        CASE WHEN v_rarity = 'legendary' THEN 'red' ELSE 'blue' END,
        jsonb_build_object('user_id', v_user, 'rarity', v_rarity, 'prize_name', v_prize.label));
    EXCEPTION WHEN OTHERS THEN NULL; -- never let banner failure block the prize
    END;
  END IF;

  SELECT COALESCE(gems, 0) INTO v_gems_left FROM public.profiles WHERE id = v_user;
  SELECT COUNT(*)::int INTO v_opens_count FROM public.lucky_box_opens WHERE user_id = v_user;

  v_result := jsonb_build_object('ok', true, 'rarity', v_rarity, 'prize_id', v_prize.id,
    'label', v_prize.label, 'icon', v_prize.icon, 'prize_type', v_prize.prize_type,
    'amount', v_prize.amount, 'gems_left', v_gems_left, 'opens_count', v_opens_count);
  RETURN v_result;
END;
$function$;
