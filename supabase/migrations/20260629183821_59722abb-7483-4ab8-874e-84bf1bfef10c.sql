
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
  v_cur_elite INTEGER;
  v_cur_elite_expires TIMESTAMPTZ;
  v_new_elite INTEGER;
  v_new_elite_expires TIMESTAMPTZ;
  v_elite_permanent BOOLEAN;
  v_deq_label text;
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

  PERFORM set_config('app.allow_reward_ship_storage_overflow', 'true', true);
  PERFORM set_config('app.allow_dragon_equipment_write','true', true);

  v_qty := GREATEST(v_row.quantity, 1);

  IF v_row.reward_type = 'bundle' THEN
    UPDATE public.profiles
       SET coins = coins + v_row.reward_coins,
           gems  = gems  + v_row.reward_gems,
           xp    = xp    + v_row.reward_xp
     WHERE id = v_user;
    v_vip_pts := v_vip_pts + (v_row.reward_gems * 10) + (v_row.reward_coins / 100) + (v_row.reward_xp / 100);

  ELSIF v_row.reward_type = 'item' AND v_row.item_id IS NOT NULL THEN
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
       SET vip_level = v_new_level, vip_expires_at = v_new_expires
     WHERE id = v_user;
  END IF;

  IF v_row.reward_elite_vip_level IS NOT NULL AND v_row.reward_elite_vip_level > 0 THEN
    SELECT elite_vip_level, elite_vip_expires_at INTO v_cur_elite, v_cur_elite_expires
      FROM public.profiles WHERE id = v_user;
    v_new_elite := GREATEST(COALESCE(v_cur_elite, 0), v_row.reward_elite_vip_level);
    v_new_elite := LEAST(5, v_new_elite);
    v_elite_permanent := (v_row.reward_elite_vip_days <= 0);
    IF v_elite_permanent THEN
      v_new_elite_expires := NULL;
    ELSE
      v_new_elite_expires := GREATEST(COALESCE(v_cur_elite_expires, now()), now())
                             + make_interval(days => v_row.reward_elite_vip_days);
    END IF;
    UPDATE public.profiles
       SET elite_vip_level = v_new_elite, elite_vip_expires_at = v_new_elite_expires
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
           SET coins = coins + v_icoins, gems = gems + v_igems, xp = xp + v_ixp
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
      ELSIF v_t = 'dragon_equipment' THEN
        -- item_kind = slot ('weapon'|'armor'|'talisman'), item_id = rarity
        v_ikind := COALESCE(v_item->>'item_kind', 'weapon');
        v_iid   := COALESCE(v_item->>'item_id', 'fatak');
        IF v_ikind NOT IN ('weapon','armor','talisman') THEN v_ikind := 'weapon'; END IF;
        IF v_iid NOT IN ('common','rare','epic','legendary','divine','fatak') THEN v_iid := 'fatak'; END IF;
        v_deq_label := COALESCE(v_item->>'label',
          CASE v_iid
            WHEN 'fatak' THEN 'فتاك'
            WHEN 'divine' THEN 'خرافي'
            WHEN 'legendary' THEN 'أسطوري'
            WHEN 'epic' THEN 'ملحمي'
            WHEN 'rare' THEN 'نادر'
            ELSE 'عادي'
          END
          || ' — ' ||
          CASE v_ikind WHEN 'weapon' THEN 'سلاح' WHEN 'armor' THEN 'درع' ELSE 'تميمة' END);
        FOR i IN 1..v_iqty LOOP
          INSERT INTO public.dragon_equipment(user_id, slot, rarity, name, stats)
          VALUES (v_user, v_ikind, v_iid, v_deq_label, '{}'::jsonb);
        END LOOP;
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
    'vip_days', v_row.reward_vip_days,
    'elite_vip_level', v_row.reward_elite_vip_level,
    'elite_vip_days', v_row.reward_elite_vip_days
  );
END;
$function$;
