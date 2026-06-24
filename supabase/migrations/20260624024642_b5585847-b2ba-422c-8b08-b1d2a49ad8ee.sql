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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_settings FROM public.lucky_box_settings LIMIT 1;
  IF v_settings IS NULL OR v_settings.enabled = false THEN RAISE EXCEPTION 'lucky_box_disabled'; END IF;
  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_settings.cost_gems THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems = gems - v_settings.cost_gems WHERE id = v_user;

  v_roll := random() * GREATEST(1, v_settings.pct_common + v_settings.pct_rare + v_settings.pct_legendary);
  IF v_roll < v_settings.pct_legendary THEN v_rarity := 'legendary';
  ELSIF v_roll < v_settings.pct_legendary + v_settings.pct_rare THEN v_rarity := 'rare';
  ELSE v_rarity := 'common'; END IF;

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
  END IF;

  INSERT INTO public.lucky_box_opens (user_id, prize_id, rarity, label, icon, prize_type, amount)
  VALUES (v_user, v_prize.id, v_rarity::lucky_box_rarity, v_prize.label, v_prize.icon, v_prize.prize_type, v_prize.amount);

  IF v_rarity IN ('rare','legendary') THEN
    INSERT INTO public.global_banners (kind, message, color, meta)
    VALUES (
      'lucky_box',
      'حصل لاعب على جائزة ' || CASE WHEN v_rarity='legendary' THEN 'نادرة جدًا 🔥' ELSE 'نادرة' END || ': ' || v_prize.label,
      CASE WHEN v_rarity='legendary' THEN 'red' ELSE 'blue' END,
      jsonb_build_object('user_id', v_user, 'rarity', v_rarity, 'prize_name', v_prize.label)
    );
  END IF;

  v_result := jsonb_build_object('rarity', v_rarity, 'prize_id', v_prize.id, 'label', v_prize.label,
    'icon', v_prize.icon, 'prize_type', v_prize.prize_type, 'amount', v_prize.amount,
    'opens_count', (SELECT COUNT(*) FROM public.lucky_box_opens WHERE user_id = v_user),
    'gems_left', (SELECT gems FROM public.profiles WHERE id = v_user),
    'ok', true);
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.open_lucky_box() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.open_lucky_box() FROM anon, PUBLIC;