
-- 1) profiles: add vip_expires_at
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vip_expires_at TIMESTAMPTZ;

-- 2) redemption_codes: add VIP reward fields
ALTER TABLE public.redemption_codes
  ADD COLUMN IF NOT EXISTS reward_vip_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_vip_days  INTEGER NOT NULL DEFAULT 0;

-- 3) vip_daily_claims table
CREATE TABLE IF NOT EXISTS public.vip_daily_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  claim_date DATE NOT NULL,
  vip_level INTEGER NOT NULL,
  gems_awarded INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, claim_date)
);

GRANT SELECT ON public.vip_daily_claims TO authenticated;
GRANT ALL ON public.vip_daily_claims TO service_role;

ALTER TABLE public.vip_daily_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdc_select_own ON public.vip_daily_claims
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_admin(auth.uid()));

CREATE POLICY vdc_admin_all ON public.vip_daily_claims
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- 4) effective_vip_level helper
CREATE OR REPLACE FUNCTION public.effective_vip_level(_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
       WHEN vip_expires_at IS NULL OR vip_expires_at > now()
         THEN GREATEST(vip_level, 1)
       ELSE 0
     END
     FROM public.profiles WHERE id = _user),
    0
  );
$$;

-- 5) grant_vip — admin grants VIP level for N days (0 = permanent)
CREATE OR REPLACE FUNCTION public.grant_vip(_user UUID, _level INTEGER, _days INTEGER)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_expires TIMESTAMPTZ;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'invalid_user'; END IF;
  IF _level < 0 OR _level > 10 THEN RAISE EXCEPTION 'invalid_level'; END IF;

  IF _days <= 0 THEN
    v_new_expires := NULL; -- permanent
  ELSE
    v_new_expires := GREATEST(COALESCE(
      (SELECT vip_expires_at FROM public.profiles WHERE id = _user),
      now()
    ), now()) + make_interval(days => _days);
  END IF;

  UPDATE public.profiles
     SET vip_level = GREATEST(vip_level, _level),
         vip_expires_at = CASE
           WHEN _days <= 0 THEN NULL
           ELSE v_new_expires
         END
   WHERE id = _user;

  INSERT INTO public.admin_audit(admin_id, target_user_id, action, details)
  VALUES (auth.uid(), _user, 'grant_vip',
          jsonb_build_object('level', _level, 'days', _days, 'expires_at', v_new_expires));

  INSERT INTO public.notifications(recipient_id, kind, title, body, created_by)
  VALUES (_user, 'reward', '👑 VIP مفعل!',
          'تم منحك VIP مستوى ' || _level::text ||
          CASE WHEN _days > 0 THEN ' لمدة ' || _days::text || ' يوم' ELSE ' بشكل دائم' END,
          auth.uid());

  RETURN jsonb_build_object('ok', true, 'level', _level, 'expires_at', v_new_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_vip(UUID, INTEGER, INTEGER) TO authenticated;

-- 6) claim_vip_daily — player claims daily gems based on level
CREATE OR REPLACE FUNCTION public.claim_vip_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_level INTEGER;
  v_gems INTEGER;
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 1 THEN RAISE EXCEPTION 'no_vip'; END IF;

  -- gems per level (matches client-side perks table)
  v_gems := CASE v_level
    WHEN 1 THEN 50  WHEN 2 THEN 100 WHEN 3 THEN 200 WHEN 4 THEN 350
    WHEN 5 THEN 500 WHEN 6 THEN 750 WHEN 7 THEN 1000 WHEN 8 THEN 1500
    WHEN 9 THEN 2000 WHEN 10 THEN 3000 ELSE 0 END;

  BEGIN
    INSERT INTO public.vip_daily_claims(user_id, claim_date, vip_level, gems_awarded)
    VALUES (v_user, v_today, v_level, v_gems);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  UPDATE public.profiles SET gems = gems + v_gems WHERE id = v_user;

  RETURN jsonb_build_object('ok', true, 'gems', v_gems, 'level', v_level);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_vip_daily() TO authenticated;

-- 7) Update redeem_code to support VIP rewards
CREATE OR REPLACE FUNCTION public.redeem_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row  public.redemption_codes%ROWTYPE;
  v_template_id INTEGER;
  v_vip_pts bigint := 0;
  v_price_coins bigint := 0;
  v_price_gems integer := 0;
  v_qty integer;
  i integer;
  v_item jsonb;
  v_t text;
  v_iid text;
  v_ikind text;
  v_iqty integer;
  v_icoins bigint;
  v_igems integer;
  v_ixp integer;
  v_shield_hours integer;
  v_new_expires timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_row FROM public.redemption_codes
   WHERE code = upper(trim(p_code)) FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF NOT v_row.active THEN RAISE EXCEPTION 'code_disabled'; END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF v_row.max_uses > 0 AND v_row.uses_count >= v_row.max_uses THEN RAISE EXCEPTION 'code_exhausted'; END IF;
  IF EXISTS (SELECT 1 FROM public.code_redemptions WHERE code_id = v_row.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  v_qty := GREATEST(v_row.quantity, 1);

  IF v_row.reward_type = 'bundle' THEN
    UPDATE public.profiles
       SET coins = coins + v_row.reward_coins,
           gems  = gems  + v_row.reward_gems,
           xp    = xp    + v_row.reward_xp
     WHERE id = v_user;
    v_vip_pts := v_vip_pts + (v_row.reward_gems * 10) + (v_row.reward_coins / 100) + (v_row.reward_xp / 100);

  ELSIF v_row.reward_type = 'item' AND v_row.item_id IS NOT NULL THEN
    IF COALESCE(v_row.item_kind,'') = 'shield' THEN
      v_shield_hours := CASE v_row.item_id
        WHEN 'shield_4h'  THEN 4
        WHEN 'shield_1d'  THEN 24
        WHEN 'shield_2d'  THEN 48
        WHEN 'shield_7d'  THEN 24*7
        WHEN 'shield_30d' THEN 24*30
        ELSE 0
      END;
      IF v_shield_hours > 0 THEN
        UPDATE public.profiles
           SET protection_until = GREATEST(COALESCE(protection_until, now()), now())
                                  + make_interval(hours => v_shield_hours * v_qty)
         WHERE id = v_user;
      END IF;
    ELSE
      INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
      VALUES (v_user, COALESCE(v_row.item_kind, 'misc'), v_row.item_id, v_qty);
      SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
        FROM public.items_catalog WHERE code = v_row.item_id LIMIT 1;
      v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_qty;
    END IF;

  ELSIF v_row.reward_type = 'ship' AND v_row.item_id IS NOT NULL THEN
    SELECT sort_order INTO v_template_id FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    FOR i IN 1..v_qty LOOP
      INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
      SELECT v_user, COALESCE(v_template_id, 1), v_row.item_id, max_hp, max_hp
        FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    END LOOP;
    SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
      FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_qty;

  ELSIF v_row.reward_type = 'vip' THEN
    -- handled below via reward_vip_level/days
    NULL;
  END IF;

  -- VIP grant from code (any reward_type can include VIP bonus too)
  IF v_row.reward_vip_level > 0 THEN
    IF v_row.reward_vip_days <= 0 THEN
      v_new_expires := NULL;
    ELSE
      v_new_expires := GREATEST(COALESCE(
        (SELECT vip_expires_at FROM public.profiles WHERE id = v_user),
        now()
      ), now()) + make_interval(days => v_row.reward_vip_days);
    END IF;

    UPDATE public.profiles
       SET vip_level = GREATEST(vip_level, v_row.reward_vip_level),
           vip_expires_at = CASE
             WHEN v_row.reward_vip_days <= 0 THEN NULL
             ELSE v_new_expires
           END
     WHERE id = v_user;
  END IF;

  -- Extra rewards (bundle of items)
  IF v_row.extra_rewards IS NOT NULL AND jsonb_typeof(v_row.extra_rewards) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_row.extra_rewards) LOOP
      v_t := COALESCE(v_item->>'type', '');
      v_iqty := GREATEST(COALESCE((v_item->>'quantity')::int, 1), 1) * v_qty;
      IF v_t = 'bundle' THEN
        v_icoins := COALESCE((v_item->>'coins')::bigint, 0);
        v_igems  := COALESCE((v_item->>'gems')::int, 0);
        v_ixp    := COALESCE((v_item->>'xp')::int, 0);
        UPDATE public.profiles
           SET coins = coins + v_icoins,
               gems  = gems  + v_igems,
               xp    = xp    + v_ixp
         WHERE id = v_user;
        v_vip_pts := v_vip_pts + (v_igems * 10) + (v_icoins / 100) + (v_ixp / 100);
      ELSIF v_t = 'item' THEN
        v_iid := v_item->>'item_id';
        v_ikind := COALESCE(v_item->>'item_kind', 'misc');
        IF v_iid IS NOT NULL THEN
          INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
          VALUES (v_user, v_ikind, v_iid, v_iqty);
          SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
            FROM public.items_catalog WHERE code = v_iid LIMIT 1;
          v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_iqty;
        END IF;
      ELSIF v_t = 'ship' THEN
        v_iid := v_item->>'item_id';
        IF v_iid IS NOT NULL THEN
          SELECT sort_order INTO v_template_id FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          FOR i IN 1..v_iqty LOOP
            INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
            SELECT v_user, COALESCE(v_template_id, 1), v_iid, max_hp, max_hp
              FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          END LOOP;
          SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
            FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_iqty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_vip_pts > 0 THEN PERFORM public.add_vip_points(v_user, v_vip_pts); END IF;

  INSERT INTO public.code_redemptions(code_id, user_id) VALUES (v_row.id, v_user);
  UPDATE public.redemption_codes SET uses_count = uses_count + 1 WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'reward_type', v_row.reward_type,
    'item_id', v_row.item_id,
    'reward_coins', v_row.reward_coins,
    'reward_gems',  v_row.reward_gems,
    'reward_xp',    v_row.reward_xp,
    'quantity', v_qty,
    'extra_rewards', v_row.extra_rewards,
    'vip_level', v_row.reward_vip_level,
    'vip_days', v_row.reward_vip_days
  );
END;
$function$;
