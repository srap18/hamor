ALTER TABLE public.lucky_box_prizes DROP CONSTRAINT IF EXISTS lucky_box_prizes_prize_type_check;
ALTER TABLE public.lucky_box_prizes ADD CONSTRAINT lucky_box_prizes_prize_type_check
  CHECK (prize_type IN ('coins','gems','rubies','xp','item','dragon_equipment'));

-- Recreate function (same as previous attempt)
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_settings FROM public.lucky_box_settings LIMIT 1;
  IF v_settings IS NULL OR v_settings.enabled = false THEN RAISE EXCEPTION 'lucky_box_disabled'; END IF;
  SELECT COALESCE(level, 1) INTO v_market_level FROM public.user_market WHERE user_id = v_user;
  IF COALESCE(v_market_level, 1) < 6 THEN RAISE EXCEPTION 'market_level_too_low'; END IF;
  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_settings.cost_gems THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems = gems - v_settings.cost_gems WHERE id = v_user;

  v_roll := random() * GREATEST(1, v_settings.pct_common + v_settings.pct_rare + v_settings.pct_legendary);
  IF v_roll < v_settings.pct_legendary THEN v_rarity := 'legendary';
  ELSIF v_roll < v_settings.pct_legendary + v_settings.pct_rare THEN v_rarity := 'rare';
  ELSE v_rarity := 'common'; END IF;

  SELECT COALESCE(SUM(weight),0) INTO v_total_weight
  FROM public.lucky_box_prizes WHERE rarity = v_rarity::app_rarity AND active = true;
  IF v_total_weight <= 0 THEN
    v_rarity := 'common';
    SELECT COALESCE(SUM(weight),0) INTO v_total_weight
    FROM public.lucky_box_prizes WHERE rarity = v_rarity::app_rarity AND active = true;
  END IF;
  IF v_total_weight <= 0 THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;

  v_pick := random() * v_total_weight;
  FOR v_prize IN
    SELECT * FROM public.lucky_box_prizes WHERE rarity = v_rarity::app_rarity AND active = true ORDER BY id
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
    ON CONFLICT (user_id, item_type, item_id)
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  END IF;

  INSERT INTO public.lucky_box_opens (user_id, prize_id, rarity, label, icon, prize_type, amount)
  VALUES (v_user, v_prize.id, v_rarity::app_rarity, v_prize.label, v_prize.icon, v_prize.prize_type, v_prize.amount);

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
    'icon', v_prize.icon, 'prize_type', v_prize.prize_type, 'amount', v_prize.amount);
  RETURN v_result;
END;
$function$;

DELETE FROM public.lucky_box_prizes;

INSERT INTO public.lucky_box_prizes (rarity, prize_type, item_type, item_id, amount, label, icon, weight, active) VALUES
('common','coins',            NULL,       NULL,           10000, '10,000 ذهب',           '🪙', 10, true),
('common','gems',             NULL,       NULL,           20,    '20 جوهرة',             '💎', 10, true),
('common','item',             'crew',     'police',       1,     'طاقم شرطي',            '👮', 8,  true),
('common','item',             'crew',     'thief',        1,     'طاقم السارق',          '🥷', 8,  true),
('common','dragon_equipment', 'weapon',   'common',       1,     'سلاح عادي',            '⚔️', 6,  true),
('common','dragon_equipment', 'armor',    'common',       1,     'درع عادي',             '🛡️', 6,  true),
('common','dragon_equipment', 'talisman', 'common',       1,     'تميمة عادي',           '📿', 6,  true),
('common','item',             'crew',     'fixer_1',      1,     'مصلح صغير',            '🔧', 8,  true),
('common','item',             'weapon',   'rocket_small', 1,     'صاروخ صغير',           '🚀', 8,  true),
('common','item',             'weapon',   'nuke',         1,     'قنبلة ذرية',           '☢️', 4,  true),
('common','item',             'crew',     'luck',         1,     'طاقم حظ',              '🍀', 6,  true),
('common','item',             'anti',     'anti_rocket',  1,     'مضاد صواريخ',          '🛡️', 6,  true),

('rare','item',             'crew',     'fixer_3',      1,  'مصلح كبير',                '⚒️', 6, true),
('rare','item',             'crew',     'guide',        1,  'المرشد',                   '🧭', 6, true),
('rare','item',             'crew',     'luck',         1,  'الحظ',                     '🍀', 6, true),
('rare','item',             'crew',     'trader',       1,  'التاجر',                   '💰', 6, true),
('rare','item',             'crew',     'sailor',       1,  'بحار',                     '⛵', 6, true),
('rare','item',             'crew',     'fixer_4',      1,  'مصلح أسطوري',              '🏆', 3, true),
('rare','gems',             NULL,       NULL,           1000, '1,000 جوهرة',            '💎', 4, true),
('rare','item',             'weapon',   'rocket_large', 1,  'صاروخ كبير',               '🚀', 5, true),
('rare','item',             'weapon',   'nuke',         10, '10 قنابل ذرية',            '☢️', 3, true),
('rare','item',             'weapon',   'ad_bomb',      5,  '5 قنابل إعلانية',          '📢', 3, true),
('rare','item',             'shield',   'shield_2d',    1,  'درع يومين',                '🛡️', 4, true),
('rare','dragon_equipment', 'weapon',   'epic',         1,  'ملحمي — سلاح',             '⚔️', 3, true),
('rare','dragon_equipment', 'armor',    'epic',         1,  'ملحمي — درع',              '🛡️', 3, true),
('rare','dragon_equipment', 'talisman', 'epic',         1,  'ملحمي — تميمة',            '📿', 3, true),
('rare','item',             'anti',     'anti_nuke',    1,  'مضاد قنبلة ذرية',          '🧯', 4, true),

('legendary','gems',             NULL,       NULL,         10000,    '10,000 جوهرة',           '💎', 4, true),
('legendary','coins',            NULL,       NULL,         30000000, '30 مليون ذهب',           '🪙', 4, true),
('legendary','item',             'weapon',   'nuke',       50,       '50 قنبلة ذرية',          '☢️', 3, true),
('legendary','item',             'weapon',   'ad_bomb',    20,       '20 قنبلة إعلانية',       '📢', 3, true),
('legendary','item',             'crew',     'luck',       10,       '10 طواقم حظ',            '🍀', 3, true),
('legendary','item',             'crew',     'golden_fisher', 1,     'الصياد الذهبي',          '🏅', 1, true),
('legendary','item',             'crew',     'guide',      10,       '10 طواقم المرشد',        '🧭', 3, true),
('legendary','item',             'crew',     'sailor',     10,       '10 طواقم بحار',          '⛵', 3, true),
('legendary','item',             'crew',     'fixer_4',    10,       '10 مصلح أسطوري',         '🏆', 2, true),
('legendary','dragon_equipment', 'talisman', 'legendary',  1,        'أسطوري — تميمة',         '📿', 2, true),
('legendary','dragon_equipment', 'talisman', 'divine',     1,        'خرافي — تميمة',          '📿', 1, true),
('legendary','dragon_equipment', 'armor',    'legendary',  1,        'أسطوري — درع',           '🛡️', 2, true),
('legendary','dragon_equipment', 'armor',    'divine',     1,        'خرافي — درع',            '🛡️', 1, true),
('legendary','dragon_equipment', 'weapon',   'legendary',  1,        'أسطوري — سلاح',          '⚔️', 2, true),
('legendary','dragon_equipment', 'weapon',   'divine',     1,        'خرافي — سلاح',           '⚔️', 1, true),
('legendary','item',             'shield',   'shield_2d',  10,       '10 دروع يومين',          '🛡️', 2, true),
('legendary','item',             'anti',     'anti_nuke',  10,       '10 مضادات قنبلة ذرية',   '🧯', 2, true),
('legendary','item',             'anti',     'anti_ad_bomb', 10,     '10 مضادات قنبلة إعلانية','🧯', 2, true);
