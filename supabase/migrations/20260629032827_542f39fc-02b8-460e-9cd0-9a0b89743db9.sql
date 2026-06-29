CREATE OR REPLACE FUNCTION public.open_lucky_box()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_settings public.lucky_box_settings;
  v_cost int;
  v_roll int;
  v_rarity text;
  v_total_weight int;
  v_pick int;
  v_acc int := 0;
  v_prize public.lucky_box_prizes;
  v_balance int;
  v_opens int;
  v_result jsonb;
  v_player_name text;
  v_notif_title text;
  v_notif_body text;
  v_rarity_ar text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_settings FROM public.lucky_box_settings WHERE id = true;
  IF NOT FOUND OR NOT v_settings.enabled THEN RAISE EXCEPTION 'lucky_box_disabled'; END IF;
  v_cost := GREATEST(0, COALESCE(v_settings.cost_gems, 0));

  SELECT gems INTO v_balance FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_cost THEN RAISE EXCEPTION 'insufficient_gems'; END IF;

  v_roll := floor(random() * GREATEST(1, COALESCE(v_settings.pct_common,0) + COALESCE(v_settings.pct_rare,0) + COALESCE(v_settings.pct_legendary,0)))::int;
  IF v_roll < COALESCE(v_settings.pct_legendary,0) THEN
    v_rarity := 'legendary';
  ELSIF v_roll < COALESCE(v_settings.pct_legendary,0) + COALESCE(v_settings.pct_rare,0) THEN
    v_rarity := 'rare';
  ELSE
    v_rarity := 'common';
  END IF;

  SELECT COALESCE(SUM(weight),0) INTO v_total_weight
  FROM public.lucky_box_prizes
  WHERE rarity = v_rarity::public.lucky_box_rarity
    AND active = true
    AND weight > 0
    AND amount > 0
    AND label IS NOT NULL
    AND btrim(label) <> ''
    AND prize_type IN ('coins','gems','rubies','xp','item','dragon_equipment')
    AND (
      prize_type IN ('coins','gems','rubies','xp')
      OR (prize_type = 'item' AND item_type IN ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') AND item_id IS NOT NULL AND btrim(item_id) <> '')
      OR (prize_type = 'dragon_equipment' AND item_type IN ('weapon','armor','talisman') AND item_id IN ('common','rare','epic','legendary','divine','fatak'))
    );

  IF v_total_weight = 0 THEN
    v_rarity := 'common';
    SELECT COALESCE(SUM(weight),0) INTO v_total_weight
    FROM public.lucky_box_prizes
    WHERE rarity = v_rarity::public.lucky_box_rarity
      AND active = true
      AND weight > 0
      AND amount > 0
      AND label IS NOT NULL
      AND btrim(label) <> ''
      AND prize_type IN ('coins','gems','rubies','xp','item','dragon_equipment')
      AND (
        prize_type IN ('coins','gems','rubies','xp')
        OR (prize_type = 'item' AND item_type IN ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') AND item_id IS NOT NULL AND btrim(item_id) <> '')
        OR (prize_type = 'dragon_equipment' AND item_type IN ('weapon','armor','talisman') AND item_id IN ('common','rare','epic','legendary','divine','fatak'))
      );
    IF v_total_weight = 0 THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;
  END IF;

  v_pick := floor(random() * v_total_weight)::int;
  FOR v_prize IN
    SELECT * FROM public.lucky_box_prizes
    WHERE rarity = v_rarity::public.lucky_box_rarity
      AND active = true
      AND weight > 0
      AND amount > 0
      AND label IS NOT NULL
      AND btrim(label) <> ''
      AND prize_type IN ('coins','gems','rubies','xp','item','dragon_equipment')
      AND (
        prize_type IN ('coins','gems','rubies','xp')
        OR (prize_type = 'item' AND item_type IN ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') AND item_id IS NOT NULL AND btrim(item_id) <> '')
        OR (prize_type = 'dragon_equipment' AND item_type IN ('weapon','armor','talisman') AND item_id IN ('common','rare','epic','legendary','divine','fatak'))
      )
    ORDER BY id
  LOOP
    v_acc := v_acc + v_prize.weight;
    EXIT WHEN v_acc > v_pick;
  END LOOP;

  IF v_prize.id IS NULL THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;

  UPDATE public.profiles SET gems = gems - v_cost WHERE id = v_user;

  IF v_prize.prize_type = 'coins' THEN
    UPDATE public.profiles SET coins = COALESCE(coins,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'gems' THEN
    UPDATE public.profiles SET gems = COALESCE(gems,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'rubies' THEN
    UPDATE public.profiles SET rubies = COALESCE(rubies,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'xp' THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + v_prize.amount WHERE id = v_user;
  ELSIF v_prize.prize_type = 'item' THEN
    UPDATE public.inventory
      SET quantity = quantity + v_prize.amount
      WHERE user_id = v_user
        AND item_type = v_prize.item_type
        AND item_id = v_prize.item_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);

    IF NOT FOUND THEN
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
      VALUES (v_user, v_prize.item_type, v_prize.item_id, v_prize.amount, NULL);
    END IF;
  ELSIF v_prize.prize_type = 'dragon_equipment' THEN
    INSERT INTO public.dragon_equipment(user_id, slot, rarity, name, stats)
    VALUES (v_user, v_prize.item_type, v_prize.item_id, v_prize.label, '{}'::jsonb);
  ELSE
    RAISE EXCEPTION 'invalid_prize_type';
  END IF;

  INSERT INTO public.lucky_box_opens (user_id, prize_id, rarity, label, icon, prize_type, amount)
  VALUES (v_user, v_prize.id, v_rarity::public.lucky_box_rarity, v_prize.label, COALESCE(v_prize.icon, '🎁'), v_prize.prize_type, v_prize.amount);

  SELECT COALESCE(display_name, username, 'لاعب')
    INTO v_player_name FROM public.profiles WHERE id = v_user;
  v_rarity_ar := CASE v_rarity WHEN 'legendary' THEN 'نادرة جدًا 🔥' WHEN 'rare' THEN 'نادرة 💎' ELSE 'عادية ✨' END;

  IF v_rarity IN ('rare', 'legendary') THEN
    BEGIN
      PERFORM set_config('app.allow_notif','true', true);
      v_notif_title := '🎁 جائزة صندوق الحظ (' || v_rarity_ar || ')';
      v_notif_body  := 'حصلت على: ' || v_prize.label || ' ' || COALESCE(v_prize.icon,'');
      INSERT INTO public.notifications (recipient_id, title, body, kind, meta)
      VALUES (v_user, v_notif_title, v_notif_body, 'lucky_personal',
        jsonb_build_object('rarity', v_rarity, 'label', v_prize.label, 'icon', v_prize.icon,
          'prize_type', v_prize.prize_type, 'amount', v_prize.amount));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      PERFORM set_config('app.allow_notif','true', true);
      INSERT INTO public.notifications (recipient_id, title, body, kind, meta)
      VALUES (NULL,
        CASE WHEN v_rarity = 'legendary' THEN '🎉🔥 مبروك! جائزة نادرة جدًا' ELSE '🎉💎 مبروك! جائزة نادرة' END,
        'مبروك للاعب ' || v_player_name || ' حصل على ' || v_prize.label || ' ' || COALESCE(v_prize.icon,''),
        CASE WHEN v_rarity = 'legendary' THEN 'lucky_legendary' ELSE 'lucky_rare' END,
        jsonb_build_object('rarity', v_rarity, 'label', v_prize.label, 'icon', v_prize.icon,
          'user_id', v_user, 'player_name', v_player_name));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      INSERT INTO public.global_banners (kind, message, color, meta)
      VALUES ('lucky_box',
        'حصل اللاعب ' || v_player_name || ' على ' || v_prize.label,
        CASE WHEN v_rarity = 'legendary' THEN 'red' ELSE 'blue' END,
        jsonb_build_object('user_id', v_user, 'rarity', v_rarity, 'prize_name', v_prize.label));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  SELECT gems INTO v_balance FROM public.profiles WHERE id = v_user;
  SELECT COUNT(*) INTO v_opens FROM public.lucky_box_opens WHERE user_id = v_user;

  v_result := jsonb_build_object(
    'ok', true,
    'rarity', v_rarity,
    'prize_id', v_prize.id,
    'label', v_prize.label,
    'icon', COALESCE(v_prize.icon, '🎁'),
    'prize_type', v_prize.prize_type,
    'amount', v_prize.amount,
    'gems_left', v_balance,
    'gems_balance', v_balance,
    'opens_count', v_opens
  );
  RETURN v_result;
END;
$function$;