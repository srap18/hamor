CREATE OR REPLACE FUNCTION public._consume_rocket_quota(_uid uuid, _item_id text, _count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _used integer; _limit integer := 100; _day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF _item_id NOT IN ('rocket_small','rocket_medium','rocket_large') THEN RETURN; END IF;
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
  v_purchase_limit int := 100;
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