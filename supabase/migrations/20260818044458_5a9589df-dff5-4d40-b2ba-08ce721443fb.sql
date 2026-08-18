-- 1) Unified shield activation from inventory
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
  v_cd timestamptz;
  v_prot timestamptz;
  v_no_wait boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_no_wait := public.elite_vip6_active(v_user);

  SELECT shield_cooldown_until, protection_until INTO v_cd, v_prot
    FROM public.profiles WHERE id = v_user FOR UPDATE;

  -- Unified 7-day cooldown across ALL shield types
  IF NOT v_no_wait AND v_cd IS NOT NULL AND v_cd > now() THEN
    RAISE EXCEPTION 'shield_cooldown:%', EXTRACT(EPOCH FROM (v_cd - now()))::int;
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

  -- No accumulation on top of existing protection
  v_new := GREATEST(now(), COALESCE(v_prot, now())) + make_interval(hours => v_hours);
  IF NOT v_no_wait THEN
    v_new := now() + make_interval(hours => v_hours);
  END IF;

  UPDATE public.profiles
     SET protection_until = v_new,
         shield_cooldown_until = GREATEST(COALESCE(shield_cooldown_until, now()), now() + interval '7 days')
   WHERE id = v_user;

  INSERT INTO public.shield_type_activations (user_id, item_id, last_activated_at)
  VALUES (v_user, _item_id, now())
  ON CONFLICT (user_id, item_id)
  DO UPDATE SET last_activated_at = now();

  RETURN jsonb_build_object('ok', true, 'until', v_new, 'hours', v_hours);
END;
$function$;

-- 2) Direct shield purchase uses the SAME unified cooldown (4-day armor cooldown removed)
CREATE OR REPLACE FUNCTION public.buy_protection(_days integer, _coins_cost bigint, _gems_cost integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new_until timestamptz;
  _cur_gems int;
  _server_gems int;
  _interval interval;
  _cd timestamptz;
  _prot timestamptz;
  _no_wait boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Prices/durations unchanged.
  IF _gems_cost = 60 THEN
    _server_gems := 60;
    _interval := interval '4 hours';
  ELSIF _gems_cost = 280 THEN
    _server_gems := 280;
    _interval := interval '1 day';
  ELSIF _gems_cost = 550 THEN
    _server_gems := 550;
    _interval := interval '2 days';
  ELSE
    RAISE EXCEPTION 'invalid shield tier';
  END IF;

  _no_wait := public.elite_vip6_active(_uid);

  SELECT gems, shield_cooldown_until, protection_until
    INTO _cur_gems, _cd, _prot
    FROM public.profiles WHERE id = _uid FOR UPDATE;

  IF NOT _no_wait AND _cd IS NOT NULL AND _cd > now() THEN
    RAISE EXCEPTION 'shield_cooldown:%', EXTRACT(EPOCH FROM (_cd - now()))::int;
  END IF;

  IF NOT _no_wait AND _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'shield_active:%', EXTRACT(EPOCH FROM (_prot - now()))::int;
  END IF;

  IF _cur_gems IS NULL OR _cur_gems < _server_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_server_gems, 0, 0);

  _new_until := GREATEST(now(), COALESCE(_prot, now())) + _interval;
  IF NOT _no_wait THEN
    _new_until := now() + _interval;
  END IF;

  UPDATE public.profiles
     SET protection_until = _new_until,
         armor_last_bought_at = now(),
         shield_cooldown_until = GREATEST(COALESCE(shield_cooldown_until, now()), now() + interval '7 days')
   WHERE id = _uid;

  RETURN _new_until;
END;
$function$;

-- 3) Skip the UNIFIED cooldown — same pricing: 100 gems per remaining day
CREATE OR REPLACE FUNCTION public.skip_shield_type_cooldown(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_cd timestamptz;
  v_secs_left int;
  v_days int;
  v_cost int;
  v_gems int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF _item_id NOT IN ('shield_1h','shield_4h','shield_1d','shield_2d','shield_7d','shield_30d') THEN
    RAISE EXCEPTION 'invalid_shield';
  END IF;

  SELECT shield_cooldown_until, COALESCE(gems, 0)
    INTO v_cd, v_gems
    FROM public.profiles WHERE id = v_user FOR UPDATE;

  IF v_cd IS NULL OR v_cd <= now() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', false, 'cost', 0);
  END IF;

  v_secs_left := EXTRACT(EPOCH FROM (v_cd - now()))::int;
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

-- 4) Dropping the shield must NOT shorten the unified cooldown
CREATE OR REPLACE FUNCTION public.drop_my_protection()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL,
         golden_fisher_no_shield = true,
         shield_cooldown_until = GREATEST(COALESCE(shield_cooldown_until, now()), now() + interval '2 minutes')
   WHERE id = auth.uid();
END;
$function$;