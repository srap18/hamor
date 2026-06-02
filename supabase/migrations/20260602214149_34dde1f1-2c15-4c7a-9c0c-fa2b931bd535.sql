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
  v_total_coins bigint := 0;
  v_total_gems  bigint := 0;
  v_total_xp    bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_ships jsonb := '[]'::jsonb;
  v_shields jsonb := '[]'::jsonb;
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
        v_shields := v_shields || jsonb_build_array(jsonb_build_object('id', v_row.item_id, 'hours', v_shield_hours * v_qty));
      END IF;
    ELSE
      INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
      VALUES (v_user, COALESCE(v_row.item_kind,'misc'), v_row.item_id, v_qty)
      ON CONFLICT (user_id, item_type, item_id)
        WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
        DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
      v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_row.item_id, 'kind', COALESCE(v_row.item_kind,'misc'), 'qty', v_qty));
    END IF;
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
          IF v_ikind = 'shield' THEN
            v_shield_hours := CASE v_iid
              WHEN 'shield_4h'  THEN 4 WHEN 'shield_1d'  THEN 24
              WHEN 'shield_2d'  THEN 48 WHEN 'shield_7d'  THEN 24*7
              WHEN 'shield_30d' THEN 24*30 ELSE 0 END;
            IF v_shield_hours > 0 THEN
              UPDATE public.profiles
                 SET protection_until = GREATEST(COALESCE(protection_until, now()), now())
                                        + make_interval(hours => v_shield_hours * v_iqty)
               WHERE id = v_user;
              v_shields := v_shields || jsonb_build_array(jsonb_build_object('id', v_iid, 'hours', v_shield_hours * v_iqty));
            END IF;
          ELSE
            INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
            VALUES (v_user, v_ikind, v_iid, v_iqty)
            ON CONFLICT (user_id, item_type, item_id)
              WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
              DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
            v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_iid, 'kind', v_ikind, 'qty', v_iqty));
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
    'ships', v_ships,
    'shields', v_shields
  );

  v_body := '';
  IF v_total_coins > 0 THEN v_body := v_body || '💰 ' || v_total_coins || ' عملة  '; END IF;
  IF v_total_gems  > 0 THEN v_body := v_body || '💎 ' || v_total_gems  || ' جوهرة  '; END IF;
  IF v_total_xp    > 0 THEN v_body := v_body || '✨ ' || v_total_xp    || ' خبرة  '; END IF;
  IF jsonb_array_length(v_items)   > 0 THEN v_body := v_body || '📦 ' || jsonb_array_length(v_items)   || ' غرض  '; END IF;
  IF jsonb_array_length(v_ships)   > 0 THEN v_body := v_body || '⛵ ' || jsonb_array_length(v_ships)   || ' سفينة  '; END IF;
  IF jsonb_array_length(v_shields) > 0 THEN v_body := v_body || '🛡 درع  '; END IF;
  IF v_body = '' THEN v_body := 'هدية من الإدارة'; END IF;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  VALUES (v_user, '🎁 هدية من الإدارة — كود ' || v_row.code, v_body, 'gift', v_admin, v_meta);

  RETURN jsonb_build_object('ok', true, 'code_id', v_row.id, 'code', v_row.code, 'meta', v_meta);
END;
$function$;