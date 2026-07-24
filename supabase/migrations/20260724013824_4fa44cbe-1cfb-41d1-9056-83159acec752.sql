
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
  v_target_lvl integer;
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

  -- =====================================================================
  -- STRONG SAME-DEVICE GUARD (hardware-anchored)
  -- Blocks any second account on the same physical device from redeeming
  -- the same code, even if the first account has since been signed out
  -- (device_accounts stores only the current owner, so we rely on the
  -- authoritative device_slots.hardware_hash and the append-only
  -- device_history log).
  -- =====================================================================

  -- 1) Authoritative hardware fingerprint (device_slots)
  IF EXISTS (
    SELECT 1
      FROM public.device_slots ds_me
      JOIN public.device_slots ds_other
        ON ds_other.hardware_hash = ds_me.hardware_hash
      JOIN public.code_redemptions cr
        ON cr.user_id = ds_other.user_id
     WHERE ds_me.user_id = v_user
       AND ds_other.user_id <> v_user
       AND cr.code_id = v_row.id
  ) THEN
    RAISE EXCEPTION 'already_redeemed_on_this_device';
  END IF;

  -- 2) Historical device ids (device_history — append-only per account)
  IF EXISTS (
    SELECT 1
      FROM public.device_history dh_me
      JOIN public.device_history dh_other
        ON dh_other.device_id = dh_me.device_id
      JOIN public.code_redemptions cr
        ON cr.user_id = dh_other.user_id
     WHERE dh_me.user_id = v_user
       AND dh_other.user_id <> v_user
       AND cr.code_id = v_row.id
       AND length(dh_me.device_id) >= 32
       AND length(dh_other.device_id) >= 32
  ) THEN
    RAISE EXCEPTION 'already_redeemed_on_this_device';
  END IF;

  -- 3) Current-owner map (device_accounts) — belt-and-suspenders
  IF EXISTS (
    SELECT 1
      FROM public.device_accounts da_me
      JOIN public.device_accounts da_other ON da_other.device_id = da_me.device_id
      JOIN public.code_redemptions cr ON cr.user_id = da_other.user_id
     WHERE da_me.user_id = v_user
       AND da_other.user_id <> v_user
       AND cr.code_id = v_row.id
  ) THEN
    RAISE EXCEPTION 'already_redeemed_on_this_device';
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
    VALUES (v_user, COALESCE(v_row.item_type, 'misc'), v_row.item_id, v_qty)
    ON CONFLICT (user_id, item_type, item_id)
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  ELSIF v_row.reward_type = 'ship' AND v_row.item_id IS NOT NULL THEN
    SELECT id INTO v_template_id FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    IF v_template_id IS NULL THEN RAISE EXCEPTION 'invalid_ship_code'; END IF;
    FOR i IN 1..v_qty LOOP
      PERFORM public.buy_ship_by_code(v_row.item_id, v_template_id, 0, 100000);
    END LOOP;

  ELSIF v_row.reward_type = 'lootbox' AND v_row.item_id IS NOT NULL THEN
    FOR i IN 1..v_qty LOOP
      INSERT INTO public.lootbox_owned (user_id, type_id, opened)
      VALUES (v_user, v_row.item_id, false);
    END LOOP;

  ELSIF v_row.reward_type = 'vip' AND v_row.item_id IS NOT NULL THEN
    v_new_level := (v_row.item_id)::int;
    v_is_permanent := COALESCE((v_row.meta->>'permanent')::boolean, false);
    SELECT vip_level, vip_expires_at INTO v_cur_level, v_cur_expires FROM public.profiles WHERE id = v_user;
    IF v_is_permanent THEN
      v_new_expires := NULL;
    ELSE
      v_new_expires := GREATEST(COALESCE(v_cur_expires, now()), now()) + (v_qty || ' days')::interval;
    END IF;
    UPDATE public.profiles
       SET vip_level = GREATEST(COALESCE(v_cur_level,0), v_new_level),
           vip_expires_at = CASE WHEN v_is_permanent THEN NULL ELSE v_new_expires END
     WHERE id = v_user;

  ELSIF v_row.reward_type = 'elite_vip' AND v_row.item_id IS NOT NULL THEN
    v_new_elite := (v_row.item_id)::int;
    v_elite_permanent := COALESCE((v_row.meta->>'permanent')::boolean, false);
    SELECT elite_vip_level, elite_vip_expires_at INTO v_cur_elite, v_cur_elite_expires FROM public.profiles WHERE id = v_user;
    IF v_elite_permanent THEN
      v_new_elite_expires := NULL;
    ELSE
      v_new_elite_expires := GREATEST(COALESCE(v_cur_elite_expires, now()), now()) + (v_qty || ' days')::interval;
    END IF;
    UPDATE public.profiles
       SET elite_vip_level = GREATEST(COALESCE(v_cur_elite,0), v_new_elite),
           elite_vip_expires_at = CASE WHEN v_elite_permanent THEN NULL ELSE v_new_elite_expires END
     WHERE id = v_user;

  ELSIF v_row.reward_type = 'bundle_multi' THEN
    IF v_row.meta ? 'items' AND jsonb_typeof(v_row.meta->'items') = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_row.meta->'items') LOOP
        v_t := COALESCE(v_item->>'type','');
        v_iid := NULLIF(v_item->>'id','');
        v_ikind := COALESCE(v_item->>'kind', COALESCE(v_item->>'item_type','misc'));
        v_iqty := GREATEST(COALESCE((v_item->>'qty')::int, 1), 1);
        v_icoins := COALESCE((v_item->>'coins')::bigint, 0);
        v_igems := COALESCE((v_item->>'gems')::int, 0);
        v_ixp := COALESCE((v_item->>'xp')::int, 0);

        IF v_t = 'currency' THEN
          UPDATE public.profiles
             SET coins = coins + v_icoins,
                 gems  = gems  + v_igems,
                 xp    = xp    + v_ixp
           WHERE id = v_user;
          v_vip_pts := v_vip_pts + (v_igems * 10) + (v_icoins / 100) + (v_ixp / 100);
        ELSIF v_t = 'item' AND v_iid IS NOT NULL THEN
          INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
          VALUES (v_user, v_ikind, v_iid, v_iqty)
          ON CONFLICT (user_id, item_type, item_id)
          DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
        ELSIF v_t = 'ship' AND v_iid IS NOT NULL THEN
          SELECT id INTO v_template_id FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          IF v_template_id IS NULL THEN RAISE EXCEPTION 'invalid_ship_code: %', v_iid; END IF;
          FOR i IN 1..v_iqty LOOP
            PERFORM public.buy_ship_by_code(v_iid, v_template_id, 0, 100000);
          END LOOP;
        ELSIF v_t = 'lootbox' AND v_iid IS NOT NULL THEN
          FOR i IN 1..v_iqty LOOP
            INSERT INTO public.lootbox_owned (user_id, type_id, opened) VALUES (v_user, v_iid, false);
          END LOOP;
        ELSIF v_t = 'vip' AND v_iid IS NOT NULL THEN
          v_new_level := (v_iid)::int;
          v_is_permanent := COALESCE((v_item->>'permanent')::boolean, false);
          SELECT vip_level, vip_expires_at INTO v_cur_level, v_cur_expires FROM public.profiles WHERE id = v_user;
          IF v_is_permanent THEN v_new_expires := NULL;
          ELSE v_new_expires := GREATEST(COALESCE(v_cur_expires, now()), now()) + (v_iqty || ' days')::interval;
          END IF;
          UPDATE public.profiles
             SET vip_level = GREATEST(COALESCE(v_cur_level,0), v_new_level),
                 vip_expires_at = CASE WHEN v_is_permanent THEN NULL ELSE v_new_expires END
           WHERE id = v_user;
        ELSIF v_t = 'elite_vip' AND v_iid IS NOT NULL THEN
          v_new_elite := (v_iid)::int;
          v_elite_permanent := COALESCE((v_item->>'permanent')::boolean, false);
          SELECT elite_vip_level, elite_vip_expires_at INTO v_cur_elite, v_cur_elite_expires FROM public.profiles WHERE id = v_user;
          IF v_elite_permanent THEN v_new_elite_expires := NULL;
          ELSE v_new_elite_expires := GREATEST(COALESCE(v_cur_elite_expires, now()), now()) + (v_iqty || ' days')::interval;
          END IF;
          UPDATE public.profiles
             SET elite_vip_level = GREATEST(COALESCE(v_cur_elite,0), v_new_elite),
                 elite_vip_expires_at = CASE WHEN v_elite_permanent THEN NULL ELSE v_new_elite_expires END
           WHERE id = v_user;
        ELSIF v_t = 'dragon_equipment' AND v_iid IS NOT NULL THEN
          v_deq_label := COALESCE(v_item->>'label', v_iid);
          v_target_lvl := COALESCE((v_item->>'level')::int, 1);
          INSERT INTO public.dragon_equipment (user_id, slot, item_id, level, label)
          VALUES (v_user, v_iid, v_iid, v_target_lvl, v_deq_label)
          ON CONFLICT (user_id, slot)
          DO UPDATE SET level = GREATEST(public.dragon_equipment.level, EXCLUDED.level),
                        label = EXCLUDED.label;
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.redemption_codes SET uses_count = uses_count + 1 WHERE id = v_row.id;

  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_row.id, v_user);

  IF v_vip_pts > 0 THEN
    PERFORM public.grant_vip_points(v_user, v_vip_pts::integer);
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', v_row.code);
END;
$function$;
