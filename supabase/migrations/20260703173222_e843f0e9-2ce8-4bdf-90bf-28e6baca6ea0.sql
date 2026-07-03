
CREATE OR REPLACE FUNCTION public.use_shield_from_inventory(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_hours int;
  v_new timestamptz;
  v_qty int;
  v_cd timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT shield_cooldown_until INTO v_cd FROM public.profiles WHERE id = v_user;
  IF v_cd IS NOT NULL AND v_cd > now() THEN
    RAISE EXCEPTION 'shield_cooldown:%', EXTRACT(EPOCH FROM (v_cd - now()))::int;
  END IF;

  v_hours := CASE _item_id
    WHEN 'shield_1h'  THEN 1
    WHEN 'shield_4h'  THEN 4
    WHEN 'shield_1d'  THEN 24
    WHEN 'shield_2d'  THEN 48
    WHEN 'shield_7d'  THEN 24 * 7
    WHEN 'shield_30d' THEN 24 * 30
    ELSE 0 END;
  IF v_hours = 0 THEN RAISE EXCEPTION 'invalid_shield'; END IF;

  SELECT quantity INTO v_qty FROM public.inventory
   WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield'
   FOR UPDATE LIMIT 1;
  IF v_qty IS NULL OR v_qty < 1 THEN RAISE EXCEPTION 'not_enough'; END IF;

  IF v_qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield';
  END IF;

  SELECT GREATEST(now(), COALESCE(protection_until, now())) + make_interval(hours => v_hours)
    INTO v_new FROM public.profiles WHERE id = v_user;
  UPDATE public.profiles SET protection_until = v_new WHERE id = v_user;

  RETURN jsonb_build_object('ok', true, 'until', v_new, 'hours', v_hours);
END;
$function$;
