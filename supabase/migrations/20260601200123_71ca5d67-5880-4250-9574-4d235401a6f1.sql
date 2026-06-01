
-- إضافة 'shield' لقائمة الأنواع المسموحة
ALTER TABLE public.inventory DROP CONSTRAINT inventory_item_type_check;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_type_check
  CHECK (item_type = ANY (ARRAY['crew'::text, 'weapon'::text, 'consumable'::text, 'decoration'::text, 'frame'::text, 'background'::text, 'name_frame'::text, 'bubble_frame'::text, 'profile_frame'::text, 'shield'::text]));

-- إعادة كتابة claim_vip_shield بدون ON CONFLICT (للاعتماد على UPDATE-then-INSERT)
CREATE OR REPLACE FUNCTION public.claim_vip_shield()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_level int;
  v_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 5 THEN RAISE EXCEPTION 'need_vip_5'; END IF;
  v_count := CASE WHEN v_level >= 9 THEN 3 WHEN v_level >= 7 THEN 2 ELSE 1 END;

  BEGIN
    INSERT INTO public.vip_shield_claims(user_id, claim_date, shields_awarded, vip_level)
    VALUES (v_user, v_today, v_count, v_level);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  UPDATE public.inventory SET quantity = quantity + v_count
   WHERE user_id = v_user AND item_id = 'shield_1h' AND item_type = 'shield';
  IF NOT FOUND THEN
    INSERT INTO public.inventory(user_id, item_id, item_type, quantity)
    VALUES (v_user, 'shield_1h', 'shield', v_count);
  END IF;

  RETURN jsonb_build_object('ok', true, 'count', v_count, 'level', v_level);
END;
$function$;
