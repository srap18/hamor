
-- 1) Fix effective_vip_level: do not treat vip_level=0 as VIP even if expires set
CREATE OR REPLACE FUNCTION public.effective_vip_level(_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
       WHEN vip_level >= 1 AND (vip_expires_at IS NULL OR vip_expires_at > now())
         THEN vip_level
       ELSE 0
     END
     FROM public.profiles WHERE id = _user),
    0
  );
$$;

-- 2) grant_vip: never downgrade permanent VIP to temporary; keep highest tier
CREATE OR REPLACE FUNCTION public.grant_vip(_user UUID, _level INTEGER, _days INTEGER)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_level   INTEGER;
  v_current_expires TIMESTAMPTZ;
  v_new_level       INTEGER;
  v_new_expires     TIMESTAMPTZ;
  v_is_permanent    BOOLEAN;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'invalid_user'; END IF;
  IF _level < 0 OR _level > 10 THEN RAISE EXCEPTION 'invalid_level'; END IF;

  SELECT vip_level, vip_expires_at
    INTO v_current_level, v_current_expires
    FROM public.profiles WHERE id = _user;

  -- Permanent if current is permanent (NULL expires & level>=1) OR new grant is permanent
  v_is_permanent := (_days <= 0) OR (COALESCE(v_current_level,0) >= 1 AND v_current_expires IS NULL);

  IF v_is_permanent THEN
    v_new_expires := NULL;
  ELSE
    v_new_expires := GREATEST(COALESCE(v_current_expires, now()), now())
                     + make_interval(days => _days);
  END IF;

  v_new_level := GREATEST(COALESCE(v_current_level, 0), _level);

  UPDATE public.profiles
     SET vip_level = v_new_level,
         vip_expires_at = v_new_expires
   WHERE id = _user;

  INSERT INTO public.admin_audit(admin_id, target_user_id, action, details)
  VALUES (auth.uid(), _user, 'grant_vip',
          jsonb_build_object('level', _level, 'days', _days,
                             'final_level', v_new_level, 'expires_at', v_new_expires));

  INSERT INTO public.notifications(recipient_id, kind, title, body, created_by)
  VALUES (_user, 'reward', '👑 VIP مفعل!',
          'تم منحك VIP مستوى ' || _level::text ||
          CASE WHEN _days > 0 THEN ' لمدة ' || _days::text || ' يوم' ELSE ' بشكل دائم' END,
          auth.uid());

  RETURN jsonb_build_object('ok', true, 'level', v_new_level, 'expires_at', v_new_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_vip(UUID, INTEGER, INTEGER) TO authenticated;

-- 3) redeem_code: stacking VIP — each recharge raises level by reward_vip_level (cap 10),
--    days accumulate on top of existing; permanent stays permanent.
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
  v_cur_level INTEGER;
  v_cur_expires TIMESTAMPTZ;
  v_new_level INTEGER;
  v_new_expires TIMESTAMPTZ;
  v_is_permanent BOOLEAN;
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
    NULL;
  END IF;

  -- VIP grant (stacking): every recharge raises level by reward_vip_level (cap 10),
  -- days accumulate; permanent stays permanent.
  IF v_row.reward_vip_level > 0 THEN
    SELECT vip_level, vip_expires_at
      INTO v_cur_level, v_cur_expires
      FROM public.profiles WHERE id = v_user;

    -- Effective current: expired counts as 0
    IF COALESCE(v_cur_level,0) >= 1
       AND (v_cur_expires IS NULL OR v_cur_expires > now()) THEN
      v_new_level := LEAST(10, v_cur_level + v_row.reward_vip_level);
    ELSE
      v_new_level := LEAST(10, v_row.reward_vip_level);
    END IF;

    v_is_permanent := (v_row.reward_vip_days <= 0)
                  OR (COALESCE(v_cur_level,0) >= 1 AND v_cur_expires IS NULL);

    IF v_is_permanent THEN
      v_new_expires := NULL;
    ELSE
      v_new_expires := GREATEST(COALESCE(v_cur_expires, now()), now())
                       + make_interval(days => v_row.reward_vip_days);
    END IF;

    UPDATE public.profiles
       SET vip_level = v_new_level,
           vip_expires_at = v_new_expires
     WHERE id = v_user;
  END IF;

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
