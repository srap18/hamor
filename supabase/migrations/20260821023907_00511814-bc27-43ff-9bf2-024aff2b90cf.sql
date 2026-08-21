CREATE OR REPLACE FUNCTION public.use_shield_from_inventory(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_hours int;
  v_new timestamptz;
  v_qty int;
  v_last timestamptz;
  v_prot timestamptz;
  v_no_wait boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_no_wait := public.elite_vip6_active(v_user);

  SELECT protection_until INTO v_prot
    FROM public.profiles WHERE id = v_user FOR UPDATE;

  -- Per-shield-type 7-day cooldown (each shield type has its own free activation)
  SELECT last_activated_at INTO v_last
    FROM public.shield_type_activations
   WHERE user_id = v_user AND item_id = _item_id;

  IF NOT v_no_wait AND v_last IS NOT NULL AND v_last + interval '7 days' > now() THEN
    RAISE EXCEPTION 'shield_cooldown:%', EXTRACT(EPOCH FROM (v_last + interval '7 days' - now()))::int;
  END IF;

  -- No stacking: cannot activate while protection is still running
  IF NOT v_no_wait AND v_prot IS NOT NULL AND v_prot > now() THEN
    RAISE EXCEPTION 'shield_active:%', EXTRACT(EPOCH FROM (v_prot - now()))::int;
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

  v_new := now() + make_interval(hours => v_hours);
  IF v_no_wait THEN
    v_new := GREATEST(now(), COALESCE(v_prot, now())) + make_interval(hours => v_hours);
  END IF;

  UPDATE public.profiles
     SET protection_until = v_new,
         shield_cooldown_until = NULL
   WHERE id = v_user;

  INSERT INTO public.shield_type_activations (user_id, item_id, last_activated_at)
  VALUES (v_user, _item_id, now())
  ON CONFLICT (user_id, item_id)
  DO UPDATE SET last_activated_at = now();

  RETURN jsonb_build_object('ok', true, 'until', v_new, 'hours', v_hours);
END;
$function$;

CREATE OR REPLACE FUNCTION public.skip_shield_type_cooldown(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_last timestamptz;
  v_secs_left int;
  v_days int;
  v_cost int;
  v_gems int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF _item_id NOT IN ('shield_1h','shield_4h','shield_1d','shield_2d','shield_7d','shield_30d') THEN
    RAISE EXCEPTION 'invalid_shield';
  END IF;

  SELECT COALESCE(gems, 0) INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;

  SELECT last_activated_at INTO v_last
    FROM public.shield_type_activations
   WHERE user_id = v_user AND item_id = _item_id;

  IF v_last IS NULL OR v_last + interval '7 days' <= now() THEN
    UPDATE public.profiles SET shield_cooldown_until = NULL WHERE id = v_user;
    RETURN jsonb_build_object('ok', true, 'skipped', false, 'cost', 0);
  END IF;

  v_secs_left := EXTRACT(EPOCH FROM (v_last + interval '7 days' - now()))::int;
  v_days := GREATEST(1, CEIL(v_secs_left::numeric / 86400.0)::int);
  v_cost := v_days * 100;

  IF v_gems < v_cost THEN
    RAISE EXCEPTION 'not_enough_gems:%', v_cost;
  END IF;

  PERFORM public._mutate_currency(v_user, 0, -v_cost, 0, 0);

  UPDATE public.profiles SET shield_cooldown_until = NULL WHERE id = v_user;

  DELETE FROM public.shield_type_activations
   WHERE user_id = v_user AND item_id = _item_id;

  RETURN jsonb_build_object('ok', true, 'skipped', true, 'cost', v_cost, 'days', v_days);
END;
$function$;

UPDATE public.profiles SET shield_cooldown_until = NULL WHERE shield_cooldown_until IS NOT NULL;