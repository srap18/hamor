-- Shields should always go to inventory and be activated manually.

-- 1) New RPC for shop: buy shield -> inventory (no immediate activation)
CREATE OR REPLACE FUNCTION public.buy_shield_to_inventory(
  _item_id text, _qty int, _coins_cost bigint, _gems_cost int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _hours int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad qty'; END IF;
  IF _coins_cost < 0 OR _gems_cost < 0 THEN RAISE EXCEPTION 'bad cost'; END IF;

  _hours := CASE _item_id
    WHEN 'shield_1h' THEN 1
    WHEN 'shield_4h' THEN 4
    WHEN 'shield_1d' THEN 24
    WHEN 'shield_2d' THEN 48
    WHEN 'shield_7d' THEN 24*7
    WHEN 'shield_30d' THEN 24*30
    ELSE 0 END;
  IF _hours = 0 THEN RAISE EXCEPTION 'invalid_shield'; END IF;

  -- Deduct currency
  PERFORM public._mutate_currency(_uid, -_coins_cost, -_gems_cost, 0, 0);

  -- Add to inventory
  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_uid, 'shield', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buy_shield_to_inventory(text, int, bigint, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_shield_to_inventory(text, int, bigint, int) TO authenticated;

-- 2) Extend use_shield_from_inventory to support 7d/30d
CREATE OR REPLACE FUNCTION public.use_shield_from_inventory(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_hours int;
  v_new timestamptz;
  v_qty int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_hours := CASE _item_id
    WHEN 'shield_1h' THEN 1
    WHEN 'shield_4h' THEN 4
    WHEN 'shield_1d' THEN 24
    WHEN 'shield_2d' THEN 48
    WHEN 'shield_7d' THEN 24*7
    WHEN 'shield_30d' THEN 24*30
    ELSE 0 END;
  IF v_hours = 0 THEN RAISE EXCEPTION 'invalid_shield'; END IF;

  SELECT quantity INTO v_qty FROM public.inventory
   WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield' LIMIT 1;
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

-- 3) redeem_code: route shields to inventory instead of activating
CREATE OR REPLACE FUNCTION public.redeem_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_cur_level INTEGER;
  v_cur_expires TIMESTAMPTZ;
  v_new_level INTEGER;
  v_new_expires TIMESTAMPTZ;
  v_is_permanent BOOLEAN;
  v_norm text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_norm := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]+', '', 'g'));

  SELECT * INTO v_row FROM public.redemption_codes
   WHERE upper(regexp_replace(code, '[\s-]+', '', 'g')) = v_norm
   FOR UPDATE;

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
    -- Shields go to inventory like any other item now.
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, COALESCE(v_row.item_kind, 'misc'), v_row.item_id, v_qty)
    ON CONFLICT (user_id, item_type, item_id) WHERE (meta IS NULL OR (meta ->> 'assigned_ship_id') IS NULL)
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

    IF COALESCE(v_row.item_kind,'') <> 'shield' THEN
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

  IF v_row.reward_vip_level IS NOT NULL AND v_row.reward_vip_level > 0 THEN
    SELECT vip_level, vip_expires_at INTO v_cur_level, v_cur_expires
      FROM public.profiles WHERE id = v_user;

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
          VALUES (v_user, v_ikind, v_iid, v_iqty)
          ON CONFLICT (user_id, item_type, item_id) WHERE (meta IS NULL OR (meta ->> 'assigned_ship_id') IS NULL)
          DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

          IF v_ikind <> 'shield' THEN
            SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
              FROM public.items_catalog WHERE code = v_iid LIMIT 1;
            v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_iqty;
          END IF;
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

-- 4) admin_redeem_code_for: same — shields to inventory
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
  v_total_coins bigint := 0;
  v_total_gems  bigint := 0;
  v_total_xp    bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_ships jsonb := '[]'::jsonb;
  v_meta jsonb;
  v_body text;
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
    v_total_coins := v_total_coins + v_row.reward_coins;
    v_total_gems  := v_total_gems  + v_row.reward_gems;
    v_total_xp    := v_total_xp    + v_row.reward_xp;
    v_vip_pts := v_vip_pts + (v_row.reward_gems * 10) + (v_row.reward_coins / 100) + (v_row.reward_xp / 100);
  ELSIF v_row.reward_type = 'item' AND v_row.item_id IS NOT NULL THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, COALESCE(v_row.item_kind,'misc'), v_row.item_id, v_qty)
    ON CONFLICT (user_id, item_type, item_id)
      WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
      DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_row.item_id, 'kind', COALESCE(v_row.item_kind,'misc'), 'qty', v_qty));
  ELSIF v_row.reward_type = 'ship' AND v_row.item_id IS NOT NULL THEN
    SELECT sort_order INTO v_template_id FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    FOR i IN 1..v_qty LOOP
      INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
      SELECT v_user, COALESCE(v_template_id, 1), v_row.item_id, max_hp, max_hp
        FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    END LOOP;
    v_ships := v_ships || jsonb_build_array(jsonb_build_object('id', v_row.item_id, 'qty', v_qty));
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
        v_total_coins := v_total_coins + v_icoins;
        v_total_gems  := v_total_gems  + v_igems;
        v_total_xp    := v_total_xp    + v_ixp;
        v_vip_pts := v_vip_pts + (v_igems * 10) + (v_icoins / 100) + (v_ixp / 100);
      ELSIF v_t = 'item' THEN
        v_iid := v_item->>'item_id';
        v_ikind := COALESCE(v_item->>'item_kind', 'misc');
        IF v_iid IS NOT NULL THEN
          INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
          VALUES (v_user, v_ikind, v_iid, v_iqty)
          ON CONFLICT (user_id, item_type, item_id)
            WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
            DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
          v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_iid, 'kind', v_ikind, 'qty', v_iqty));
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
          v_ships := v_ships || jsonb_build_array(jsonb_build_object('id', v_iid, 'qty', v_iqty));
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

  v_meta := jsonb_build_object(
    'code', v_row.code,
    'coins', v_total_coins,
    'gems', v_total_gems,
    'xp', v_total_xp,
    'items', v_items,
    'ships', v_ships
  );

  v_body := '';
  IF v_total_coins > 0 THEN v_body := v_body || '💰 ' || v_total_coins || ' عملة  '; END IF;
  IF v_total_gems  > 0 THEN v_body := v_body || '💎 ' || v_total_gems  || ' جوهرة  '; END IF;
  IF v_total_xp    > 0 THEN v_body := v_body || '✨ ' || v_total_xp    || ' خبرة  '; END IF;
  IF jsonb_array_length(v_items)   > 0 THEN v_body := v_body || '📦 ' || jsonb_array_length(v_items)   || ' غرض  '; END IF;
  IF jsonb_array_length(v_ships)   > 0 THEN v_body := v_body || '⛵ ' || jsonb_array_length(v_ships)   || ' سفينة  '; END IF;
  IF v_body = '' THEN v_body := 'هدية من الإدارة'; END IF;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  VALUES (v_user, '🎁 هدية من الإدارة — كود ' || v_row.code, v_body, 'gift', v_admin, v_meta);

  RETURN jsonb_build_object('ok', true, 'code_id', v_row.id, 'code', v_row.code, 'meta', v_meta);
END;
$function$;

-- 5) grant_paddle_purchase: route shield_days into inventory shield_2d items
CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer, _shield_days integer,
  _vip_days integer, _env text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing record;
  v_shield_item text;
  v_shield_qty int;
BEGIN
  SELECT * INTO v_existing FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;
  IF found AND v_existing.granted THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'pack_id', v_existing.pack_id);
  END IF;

  INSERT INTO public.paddle_purchases (user_id, paddle_transaction_id, pack_id, status, amount_cents, granted, granted_at, environment)
  VALUES (_user, _txn_id, _pack_id, 'paid', _amount_cents, true, now(), _env)
  ON CONFLICT (paddle_transaction_id) DO UPDATE SET status='paid', granted=true, granted_at=now();

  IF coalesce(_gems,0) > 0 OR coalesce(_coins,0) > 0 OR coalesce(_rubies,0) > 0 THEN
    UPDATE public.profiles
       SET gems = gems + coalesce(_gems,0),
           coins = coins + coalesce(_coins,0),
           rubies = rubies + coalesce(_rubies,0)
     WHERE id = _user;
  END IF;

  -- Shields → inventory (manual activation). Pick item id by total hours.
  IF coalesce(_shield_days,0) > 0 THEN
    IF _shield_days >= 30 AND (_shield_days % 30) = 0 THEN
      v_shield_item := 'shield_30d'; v_shield_qty := _shield_days / 30;
    ELSIF _shield_days >= 7 AND (_shield_days % 7) = 0 THEN
      v_shield_item := 'shield_7d';  v_shield_qty := _shield_days / 7;
    ELSIF (_shield_days % 2) = 0 THEN
      v_shield_item := 'shield_2d';  v_shield_qty := _shield_days / 2;
    ELSE
      v_shield_item := 'shield_1d';  v_shield_qty := _shield_days;
    END IF;
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (_user, 'shield', v_shield_item, v_shield_qty)
    ON CONFLICT (user_id, item_type, item_id)
      WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
      DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  END IF;

  IF coalesce(_vip_days,0) > 0 THEN
    UPDATE public.profiles
       SET protection_until = greatest(coalesce(protection_until, now()), now()) + (_vip_days || ' days')::interval
     WHERE id = _user;
  END IF;

  PERFORM public.add_vip_points(_user, coalesce(_amount_cents, 0)::bigint);

  RETURN jsonb_build_object('ok', true, 'pack_id', _pack_id, 'vip_points_earned', coalesce(_amount_cents,0));
END $function$;