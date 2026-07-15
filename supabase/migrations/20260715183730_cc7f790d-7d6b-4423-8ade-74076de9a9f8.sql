
CREATE OR REPLACE FUNCTION public.upgrade_dragon_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_rarity text;
  v_slot text;
  v_next text;
  v_cost int;
  v_have int;
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

  -- خصم مُسجّل بمصدر واضح بدل التعديل المباشر
  PERFORM public._mutate_currency(v_user, 0, -v_cost, 0, 0);
  INSERT INTO public.economy_audit (user_id, gems_delta, gems_before, gems_after, source, reason)
  VALUES (v_user, -v_cost, v_have, v_have - v_cost, 'dragon_upgrade', 'rarity=' || v_next);

  UPDATE dragon_equipment
    SET rarity = v_next, stats = v_new_stats
    WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true, 'rarity', v_next, 'cost', v_cost);
END $function$;

CREATE OR REPLACE FUNCTION public.smelt_dragon_items(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_cost int := 1000;
  v_gems int;
  v_count int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT count(*) INTO v_count FROM dragon_equipment
    WHERE id = ANY(p_ids) AND user_id = v_user AND NOT smelted;
  IF v_count = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد قطع'); END IF;

  SELECT gems INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF COALESCE(v_gems, 0) < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'جواهر غير كافية');
  END IF;

  PERFORM public._mutate_currency(v_user, 0, -v_cost, 0, 0);
  INSERT INTO public.economy_audit (user_id, gems_delta, gems_before, gems_after, source, reason)
  VALUES (v_user, -v_cost, v_gems, v_gems - v_cost, 'dragon_smelt', 'items=' || v_count);

  UPDATE dragon_equipment SET smelted = true WHERE id = ANY(p_ids) AND user_id = v_user;

  RETURN jsonb_build_object('ok', true, 'cost', v_cost, 'items', v_count, 'gems_left', v_gems - v_cost);
END $function$;
