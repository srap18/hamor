CREATE OR REPLACE FUNCTION public._consume_rocket_quota(_uid uuid, _item_id text, _count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _used integer; _limit integer := 30; _day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF _item_id NOT IN ('rocket_small','rocket_medium','rocket_large') THEN RETURN; END IF;
  -- Elite VIP 6 → unlimited weapon purchases (no daily cap at all)
  IF public.elite_vip6_active(_uid) THEN RETURN; END IF;
  INSERT INTO public.rocket_daily_purchases(user_id, day, qty)
    VALUES (_uid, _day, 0)
    ON CONFLICT (user_id, day) DO NOTHING;
  SELECT qty INTO _used FROM public.rocket_daily_purchases
    WHERE user_id = _uid AND day = _day FOR UPDATE;
  IF _used + _count > _limit THEN
    RAISE EXCEPTION 'rocket_daily_limit:%', GREATEST(_limit - _used, 0);
  END IF;
  UPDATE public.rocket_daily_purchases
    SET qty = qty + _count, updated_at = now()
    WHERE user_id = _uid AND day = _day;
END $function$;

CREATE OR REPLACE FUNCTION public.daily_rockets_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_rarity int;
  v_bonus_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_last date;
  v_used int := 0;
  v_purchase_limit int := 30;
  v_unlimited boolean := false;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  SELECT COALESCE((public.player_attack_bonus(v_user)->>'weapon_rarity')::int, 0) INTO v_rarity;
  v_bonus_count := CASE v_rarity WHEN 5 THEN 5 WHEN 4 THEN 2 WHEN 3 THEN 1 ELSE 0 END;
  SELECT last_daily_rockets INTO v_last FROM public.dragon_claims WHERE user_id = v_user;
  IF public.elite_vip6_active(v_user) THEN
    v_unlimited := true;
    v_purchase_limit := 999999;
  END IF;
  SELECT COALESCE(qty, 0) INTO v_used
  FROM public.rocket_daily_purchases
  WHERE user_id = v_user AND day = v_today;
  RETURN jsonb_build_object(
    'available', (v_bonus_count > 0 AND (v_last IS NULL OR v_last < v_today)),
    'count', v_bonus_count,
    'tier', v_rarity,
    'unlimited', v_unlimited,
    'purchase_limit', v_purchase_limit,
    'purchased_today', v_used,
    'purchase_remaining', GREATEST(v_purchase_limit - v_used, 0)
  );
END;
$function$;

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
  v_last timestamptz;
  v_week_secs int;
  v_no_wait boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_no_wait := public.elite_vip6_active(v_user);

  SELECT shield_cooldown_until INTO v_cd FROM public.profiles WHERE id = v_user;
  IF NOT v_no_wait AND v_cd IS NOT NULL AND v_cd > now() THEN
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

  -- Per-type weekly cooldown — Elite VIP 6 skips it entirely
  IF NOT v_no_wait THEN
    SELECT last_activated_at INTO v_last
      FROM public.shield_type_activations
     WHERE user_id = v_user AND item_id = _item_id
     FOR UPDATE;
    IF v_last IS NOT NULL AND v_last + interval '7 days' > now() THEN
      v_week_secs := EXTRACT(EPOCH FROM ((v_last + interval '7 days') - now()))::int;
      RAISE EXCEPTION 'shield_type_cooldown:%', v_week_secs;
    END IF;
  END IF;

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

  INSERT INTO public.shield_type_activations (user_id, item_id, last_activated_at)
  VALUES (v_user, _item_id, now())
  ON CONFLICT (user_id, item_id)
  DO UPDATE SET last_activated_at = now();

  RETURN jsonb_build_object('ok', true, 'until', v_new, 'hours', v_hours);
END;
$function$;