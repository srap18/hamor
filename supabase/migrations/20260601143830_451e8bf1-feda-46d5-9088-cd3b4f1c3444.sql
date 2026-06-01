
-- 1) Apply attack-style gating to send_support
CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _sender_name text;
  _sender_emoji text;
  _ship_owner uuid;
  _crew_qty int;
  _msg text;
  _expires timestamptz := now() + interval '24 hours';
  _is_fixer boolean;
  _is_trader boolean;
  _already_assigned int;
  _trader_ends timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  -- Gate: sender + recipient must both meet PvP/market requirements (mirrors attacks)
  -- Admins bypass to allow support testing/management
  IF NOT public.is_admin(_me) THEN
    IF NOT public.has_pvp_fleet(_me) THEN
      RAISE EXCEPTION 'sender needs pvp fleet: 3 ships of level 6 or higher';
    END IF;
    IF NOT public.has_fishing_ship(_me) THEN
      RAISE EXCEPTION 'sender needs fishing ship: send a ship to fish first';
    END IF;
    IF NOT public.is_market_pvp_unlocked(_recipient_id) THEN
      RAISE EXCEPTION 'recipient is a new player (market level under 6)';
    END IF;
  END IF;

  SELECT display_name, avatar_emoji INTO _sender_name, _sender_emoji
  FROM public.profiles WHERE id = _me;
  IF _sender_name IS NULL THEN _sender_name := 'صديق'; END IF;
  IF _sender_emoji IS NULL THEN _sender_emoji := '🤝'; END IF;

  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id;
  IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
    RAISE EXCEPTION 'target ship does not belong to recipient';
  END IF;

  IF _kind = 'repair' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE id = _ship_id;
    _msg := 'إصلاح فوري للسفينة';
    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'repair', 0, _msg, true);
    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id, '🛠️ صلّح لك سفينتك!',
      _sender_emoji || ' ' || _sender_name || ' أصلح سفينتك بالكامل', 'support', _me);
  ELSE
    IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew id'; END IF;
    _is_fixer  := _crew_id IN ('fixer_1','fixer_2','fixer_3');
    _is_trader := _crew_id = 'trader';

    SELECT quantity INTO _crew_qty FROM public.inventory
      WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
      FOR UPDATE;
    IF _crew_qty IS NULL OR _crew_qty < 1 THEN RAISE EXCEPTION 'sender has no such crew'; END IF;
    IF _crew_qty = 1 THEN
      DELETE FROM public.inventory WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1
        WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
          AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
    END IF;

    IF _is_fixer THEN
      UPDATE public.ships_owned
         SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
       WHERE id = _ship_id;
    ELSIF _is_trader THEN
      _trader_ends := now() + interval '10 hours';
      INSERT INTO public.user_market_state(user_id, trader_until)
        VALUES (_recipient_id, _trader_ends)
      ON CONFLICT (user_id) DO UPDATE
        SET trader_until = GREATEST(
              COALESCE(public.user_market_state.trader_until, now()),
              EXCLUDED.trader_until),
            updated_at = now();
    ELSE
      SELECT count(*) INTO _already_assigned FROM public.inventory
        WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
          AND meta->>'assigned_ship_id' = _ship_id::text;
      IF _already_assigned > 0 THEN
        RAISE EXCEPTION 'recipient ship already has this crew';
      END IF;
      BEGIN
        INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
        VALUES (_recipient_id, 'crew', _crew_id, 1,
                jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.inventory
           SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
         WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
           AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
      END;
    END IF;

    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'crew', 0,
            CASE WHEN _is_trader THEN 'تاجر سوق لمدة 10 ساعات' ELSE 'طاقم: ' || _crew_id END, true);

    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id,
      CASE WHEN _is_trader THEN '💰 تاجر سوق وصلك!' ELSE '⚓ طاقم وصل سفينتك!' END,
      _sender_emoji || ' ' || _sender_name ||
      CASE WHEN _is_trader THEN ' أرسل لك تاجر سوق (10 ساعات)' ELSE ' أرسل لك طاقم: ' || _crew_id END,
      'support', _me);
  END IF;
END;
$function$;

-- 2) Admin redeem code for any user
CREATE OR REPLACE FUNCTION public.admin_redeem_code_for(p_code text, p_target_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := p_target_user;
  v_admin UUID := auth.uid();
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
BEGIN
  IF v_admin IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_admin(v_admin) THEN RAISE EXCEPTION 'admin_only'; END IF;
  IF v_user IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;

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
        WHEN 'shield_4h'  THEN 4 WHEN 'shield_1d'  THEN 24
        WHEN 'shield_2d'  THEN 48 WHEN 'shield_7d'  THEN 24*7
        WHEN 'shield_30d' THEN 24*30 ELSE 0 END;
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
           SET coins = coins + v_icoins, gems = gems + v_igems, xp = xp + v_ixp
         WHERE id = v_user;
        v_vip_pts := v_vip_pts + (v_igems * 10) + (v_icoins / 100) + (v_ixp / 100);
      ELSIF v_t = 'item' THEN
        v_iid := v_item->>'item_id';
        v_ikind := COALESCE(v_item->>'item_kind', 'misc');
        IF v_iid IS NOT NULL THEN
          INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
          VALUES (v_user, v_ikind, v_iid, v_iqty);
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
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_vip_pts > 0 THEN
    UPDATE public.profiles SET vip_points = vip_points + v_vip_pts WHERE id = v_user;
  END IF;

  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_row.id, v_user);
  UPDATE public.redemption_codes SET uses_count = uses_count + 1 WHERE id = v_row.id;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (v_admin, 'admin_redeem_code_for', v_user,
          jsonb_build_object('code', v_row.code, 'code_id', v_row.id));

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (v_user, '🎁 هدية من الإدارة',
          'تم تفعيل كود "' || v_row.code || '" لحسابك', 'reward', v_admin);

  RETURN jsonb_build_object('ok', true, 'code_id', v_row.id, 'code', v_row.code);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_redeem_code_for(text, uuid) TO authenticated;
