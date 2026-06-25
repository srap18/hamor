
-- Add smelted flag to dragon_equipment
ALTER TABLE public.dragon_equipment
  ADD COLUMN IF NOT EXISTS smelted boolean NOT NULL DEFAULT false;

-- Rebuild smelt_dragon_items with luck system + lock smelted items
CREATE OR REPLACE FUNCTION public.smelt_dragon_items(
  p_a_id uuid,
  p_b_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_cost int := 1000;
  v_gems int;
  v_a record;
  v_b record;
  v_rarity_order text[] := ARRAY['common','rare','epic','legendary','divine'];
  v_a_idx int;
  v_b_idx int;
  v_max_idx int;
  v_roll numeric;
  v_result_idx int;
  v_result_rarity text;
  v_outcome text;
  v_new_id uuid;
  v_new_name text;
  v_stats jsonb;
  v_attack int;
  v_crit int;
  v_p_up numeric;
  v_p_same numeric;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_a_id = p_b_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يمكن دمج نفس القطعة مع نفسها');
  END IF;

  SELECT * INTO v_a FROM public.dragon_equipment
    WHERE id = p_a_id AND user_id = v_user FOR UPDATE;
  SELECT * INTO v_b FROM public.dragon_equipment
    WHERE id = p_b_id AND user_id = v_user FOR UPDATE;

  IF v_a.id IS NULL OR v_b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'القطع غير موجودة');
  END IF;

  IF v_a.slot <> v_b.slot THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب دمج قطع من نفس النوع');
  END IF;

  -- Block already-smelted items from being re-smelted
  IF COALESCE(v_a.smelted, false) OR COALESCE(v_b.smelted, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'القطع المصهورة لا يمكن صهرها مرة أخرى');
  END IF;

  -- Block equipped items (extra safety)
  IF COALESCE(v_a.equipped, false) OR COALESCE(v_b.equipped, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'انزع التجهيز قبل الصهر');
  END IF;

  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'جواهر غير كافية (1000 جوهرة)');
  END IF;
  UPDATE public.profiles SET gems = gems - v_cost WHERE id = v_user;

  v_a_idx := array_position(v_rarity_order, v_a.rarity);
  v_b_idx := array_position(v_rarity_order, v_b.rarity);
  v_max_idx := GREATEST(v_a_idx, v_b_idx);

  v_roll := random();

  IF v_a_idx = v_b_idx THEN
    -- Same rarity: 40% upgrade, 45% same, 15% downgrade
    v_p_up := 0.40;
    v_p_same := 0.85;
    IF v_roll < v_p_up THEN
      v_result_idx := LEAST(v_a_idx + 1, array_length(v_rarity_order,1));
      v_outcome := CASE WHEN v_result_idx > v_a_idx THEN 'upgrade' ELSE 'same' END;
    ELSIF v_roll < v_p_same THEN
      v_result_idx := v_a_idx;
      v_outcome := 'same';
    ELSE
      v_result_idx := GREATEST(v_a_idx - 1, 1);
      v_outcome := CASE WHEN v_result_idx < v_a_idx THEN 'downgrade' ELSE 'same' END;
    END IF;
  ELSE
    -- Different rarity: 20% upgrade-of-max, 55% max, 25% downgrade
    v_p_up := 0.20;
    v_p_same := 0.75;
    IF v_roll < v_p_up THEN
      v_result_idx := LEAST(v_max_idx + 1, array_length(v_rarity_order,1));
      v_outcome := CASE WHEN v_result_idx > v_max_idx THEN 'upgrade' ELSE 'same' END;
    ELSIF v_roll < v_p_same THEN
      v_result_idx := v_max_idx;
      v_outcome := 'same';
    ELSE
      v_result_idx := GREATEST(v_max_idx - 1, 1);
      v_outcome := 'downgrade';
    END IF;
  END IF;

  v_result_rarity := v_rarity_order[v_result_idx];

  v_attack := CASE v_result_rarity
    WHEN 'common' THEN 5
    WHEN 'rare' THEN 15
    WHEN 'epic' THEN 25
    WHEN 'legendary' THEN 35
    WHEN 'divine' THEN 50
  END;
  v_crit := CASE v_result_rarity
    WHEN 'common' THEN 0
    WHEN 'rare' THEN 5
    WHEN 'epic' THEN 10
    WHEN 'legendary' THEN 15
    WHEN 'divine' THEN 20
  END;
  v_stats := jsonb_build_object('attack_pct', v_attack, 'crit', v_crit);

  v_new_name := CASE v_a.slot
    WHEN 'weapon' THEN 'سلاح مصهور'
    WHEN 'armor' THEN 'درع مصهور'
    ELSE 'تميمة مصهورة'
  END;

  DELETE FROM public.dragon_equipment WHERE id IN (p_a_id, p_b_id);

  INSERT INTO public.dragon_equipment(user_id, slot, rarity, name, stats, equipped, smelted)
  VALUES (v_user, v_a.slot, v_result_rarity, v_new_name, v_stats, false, true)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'rarity', v_result_rarity,
    'new_id', v_new_id,
    'gems_left', v_gems - v_cost
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.smelt_dragon_items(uuid, uuid) TO authenticated;
