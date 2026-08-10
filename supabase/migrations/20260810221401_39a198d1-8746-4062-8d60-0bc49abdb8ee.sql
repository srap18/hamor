-- 1) allow level 6
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_elite_vip_level_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_elite_vip_level_check CHECK (elite_vip_level >= 0 AND elite_vip_level <= 6);
ALTER TABLE public.elite_vip_tier_config DROP CONSTRAINT IF EXISTS elite_vip_tier_config_level_check;
ALTER TABLE public.elite_vip_tier_config ADD CONSTRAINT elite_vip_tier_config_level_check CHECK (level >= 1 AND level <= 6);

INSERT INTO public.elite_vip_tier_config
  (level, name_ar, emoji, monthly_price_usd, paddle_price_id, combat_bonus_pct, shop_discount_pct, daily_gems, cashback_pct, name_color)
VALUES
  (6, 'إمبراطور المحيط', '🔱', 400.00, 'elite_vip_6_monthly', 40, 35, 1500, 35, '#22D3EE')
ON CONFLICT (level) DO UPDATE SET
  name_ar = EXCLUDED.name_ar, emoji = EXCLUDED.emoji,
  monthly_price_usd = EXCLUDED.monthly_price_usd, paddle_price_id = EXCLUDED.paddle_price_id,
  combat_bonus_pct = EXCLUDED.combat_bonus_pct, shop_discount_pct = EXCLUDED.shop_discount_pct,
  daily_gems = EXCLUDED.daily_gems, cashback_pct = EXCLUDED.cashback_pct,
  name_color = EXCLUDED.name_color, updated_at = now();

-- 2) widen the elite_vip_[1-5] regexes in existing functions to [1-6]
DO $mig$
DECLARE r record; newdef text;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_get_functiondef(p.oid) LIKE '%elite_vip_[[]1-5]%'
  LOOP
    newdef := replace(r.def, 'elite_vip_[1-5]', 'elite_vip_[1-6]');
    EXECUTE newdef;
  END LOOP;
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_get_functiondef(p.oid) LIKE '%elite_vip_([[]1-5])%'
  LOOP
    newdef := replace(r.def, 'elite_vip_([1-5])', 'elite_vip_([1-6])');
    EXECUTE newdef;
  END LOOP;
END $mig$;

-- 3) VIP6 helper
CREATE OR REPLACE FUNCTION public.elite_vip6_active(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _uid
      AND COALESCE(p.elite_vip_level, 0) >= 6
      AND (p.elite_vip_expires_at IS NULL OR p.elite_vip_expires_at > now())
  );
$$;
GRANT EXECUTE ON FUNCTION public.elite_vip6_active(uuid) TO authenticated, service_role;

-- 4) permanent fish freeze for VIP6
CREATE OR REPLACE FUNCTION public._rot_frozen_seconds(_uid uuid, _caught timestamp with time zone, _now timestamp with time zone)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN public.elite_vip6_active(_uid)
    THEN GREATEST(0, EXTRACT(EPOCH FROM (_now - _caught)))::numeric
    ELSE COALESCE((
      SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(COALESCE(NULLIF(w->>'e','')::timestamptz, _now), _now)
               - GREATEST(COALESCE(NULLIF(w->>'s','')::timestamptz, _caught), _caught)
             ))))
        FROM public.user_market_state ums,
             LATERAL jsonb_array_elements(
               COALESCE(ums.freeze_windows, '[]'::jsonb)
               || CASE WHEN ums.freeze_started_at IS NOT NULL
                        AND ums.freeze_until IS NOT NULL
                        AND ums.freeze_until > ums.freeze_started_at
                       THEN jsonb_build_array(jsonb_build_object('s', ums.freeze_started_at, 'e', ums.freeze_until))
                       ELSE '[]'::jsonb END
             ) w
       WHERE ums.user_id = _uid
    ), 0)::numeric
  END
$$;

-- 5) +50M free market capacity
CREATE OR REPLACE FUNCTION public.user_market_capacity(_uid uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _lvl int; _rc bigint := 0; _ru timestamptz;
BEGIN
  SELECT COALESCE(level,1), COALESCE(rented_capacity,0), rented_until
    INTO _lvl, _rc, _ru
  FROM public.user_fish_market WHERE user_id = _uid;
  IF _lvl IS NULL THEN _lvl := 1; END IF;
  IF _ru IS NULL OR _ru <= now() THEN _rc := 0; END IF;
  RETURN public.fish_market_capacity(_lvl) + GREATEST(0, _rc)
       + CASE WHEN public.elite_vip6_active(_uid) THEN 50000000 ELSE 0 END;
END $$;

-- 6) permanent golden fisher
CREATE OR REPLACE FUNCTION public.golden_fisher_active_until(_user uuid)
RETURNS timestamp with time zone LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT GREATEST(
    CASE WHEN public.elite_vip6_active(_user) THEN now() + interval '1 day' ELSE '-infinity'::timestamptz END,
    COALESCE((SELECT p.golden_fisher_until FROM public.profiles p WHERE p.id = _user), '-infinity'::timestamptz),
    COALESCE((
      SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
      FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at'
    ), '-infinity'::timestamptz)
  );
$$;

-- 7) 45 daily rockets for VIP6
CREATE OR REPLACE FUNCTION public._consume_rocket_quota(_uid uuid, _item_id text, _count integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _used integer; _limit integer := 30; _day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF _item_id NOT IN ('rocket_small','rocket_medium','rocket_large') THEN RETURN; END IF;
  IF public.elite_vip6_active(_uid) THEN _limit := 45; END IF;
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
END $$;

-- 8) 3-day username cooldown for VIP6
CREATE OR REPLACE FUNCTION public.change_username(_new text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text;
  last_at timestamptz;
  next_at timestamptz;
  gap interval := interval '14 days';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('change_username:' || uid::text, 0));

  cleaned := lower(trim(_new));
  IF cleaned !~ '^[a-z0-9_]{5,20}$' THEN RAISE EXCEPTION 'INVALID_USERNAME'; END IF;

  IF public.elite_vip6_active(uid) THEN gap := interval '3 days'; END IF;

  SELECT username_changed_at INTO last_at
    FROM public.profiles WHERE id = uid FOR UPDATE;

  IF last_at IS NOT NULL AND last_at > now() - gap THEN
    next_at := last_at + gap;
    RAISE EXCEPTION 'USERNAME_COOLDOWN' USING HINT = next_at::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = cleaned AND id <> uid) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  UPDATE public.profiles
     SET username = cleaned, username_changed_at = now()
   WHERE id = uid;

  RETURN jsonb_build_object('ok', true, 'username', cleaned, 'changed_at', now());
END; $$;
