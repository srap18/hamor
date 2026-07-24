CREATE OR REPLACE FUNCTION public.redeem_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row public.redemption_codes%ROWTYPE;
  v_template_id INTEGER;
  v_vip_pts bigint := 0;
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
  v_cur_elite INTEGER;
  v_cur_elite_expires TIMESTAMPTZ;
  v_new_elite INTEGER;
  v_new_elite_expires TIMESTAMPTZ;
  v_norm text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_norm := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]+', '', 'g'));

  SELECT * INTO v_row
  FROM public.redemption_codes
  WHERE upper(regexp_replace(code, '[\s-]+', '', 'g')) = v_norm
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF NOT v_row.active THEN RAISE EXCEPTION 'code_disabled'; END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF v_row.max_uses > 0 AND v_row.uses_count >= v_row.max_uses THEN RAISE EXCEPTION 'code_exhausted'; END IF;

  -- Every code remains single-use per account.
  IF EXISTS (
    SELECT 1 FROM public.code_redemptions
    WHERE code_id = v_row.id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  -- XNV7VHHT is a public Telegram code: one use per account, not one use per device.
  -- Other codes retain the existing same-device protection.
  IF v_norm <> 'XNV7VHHT' THEN
    IF EXISTS (
      SELECT 1
      FROM public.device_slots ds_me
      JOIN public.device_slots ds_other ON ds_other.hardware_hash = ds_me.hardware_hash
      JOIN public.code_redemptions cr ON cr.user_id = ds_other.user_id
      WHERE ds_me.user_id = v_user
        AND ds_other.user_id <> v_user
        AND cr.code_id = v_row.id
    ) THEN
      RAISE EXCEPTION 'already_redeemed_on_this_device';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.device_history dh_me
      JOIN public.device_history dh_other ON dh_other.device_id = dh_me.device_id
      JOIN public.code_redemptions cr ON cr.user_id = dh_other.user_id
      WHERE dh_me.user_id = v_user
        AND dh_other.user_id <> v_user
        AND cr.code_id = v_row.id
        AND length(dh_me.device_id) >= 32
        AND length(dh_other.device_id) >= 32
    ) THEN
      RAISE EXCEPTION 'already_redeemed_on_this_device';
    END IF;

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
  END IF;

  PERFORM set_config('app.allow_reward_ship_storage_overflow', 'true', true);
  PERFORM set_config('app.allow_dragon_equipment_write', 'true', true);

  v_qty := GREATEST(v_row.quantity, 1);

  IF v_row.reward_type = 'bundle' THEN
    UPDATE public.profiles
    SET coins = coins + v_row.reward_coins,
        gems = gems + v_row.reward_gems,
        xp = xp + v_row.reward_xp
    WHERE id = v_user;
    v_vip_pts := v_vip_pts + (v_row.reward_gems * 10) + (v_row.reward_coins / 100) + (v_row.reward_xp / 100);

  ELSIF v_row.reward_type = 'item' AND v_row.item_id IS NOT NULL THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, COALESCE(v_row.item_kind, 'misc'), v_row.item_id, v_qty)
    ON CONFLICT (user_id, item_type, item_id)
      WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
      DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  ELSIF v_row.reward_type = 'ship' AND v_row.item_id IS NOT NULL THEN
    SELECT id INTO v_template_id FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    IF v_template_id IS NULL THEN RAISE EXCEPTION 'invalid_ship_code'; END IF;
    FOR i IN 1..v_qty LOOP
      PERFORM public.buy_ship_by_code(v_row.item_id, v_template_id, 0, 100000);
    END LOOP;
  END IF;

  IF COALESCE(v_row.reward_vip_level, 0) > 0 THEN
    SELECT vip_level, vip_expires_at INTO v_cur_level, v_cur_expires
    FROM public.profiles WHERE id = v_user FOR UPDATE;
    IF COALESCE(v_cur_level, 0) >= 1 AND (v_cur_expires IS NULL OR v_cur_expires > now()) THEN
      v_new_level := least(10, v_cur_level + v_row.reward_vip_level);
    ELSE
      v_new_level := least(10, v_row.reward_vip_level);
    END IF;
    IF v_row.reward_vip_days <= 0 OR (COALESCE(v_cur_level, 0) >= 1 AND v_cur_expires IS NULL) THEN
      v_new_expires := NULL;
    ELSE
      v_new_expires := greatest(COALESCE(v_cur_expires, now()), now()) + make_interval(days => v_row.reward_vip_days);
    END IF;
    UPDATE public.profiles
    SET vip_level = v_new_level, vip_expires_at = v_new_expires
    WHERE id = v_user;
  END IF;

  IF COALESCE(v_row.reward_elite_vip_level, 0) > 0 THEN
    SELECT elite_vip_level, elite_vip_expires_at INTO v_cur_elite, v_cur_elite_expires
    FROM public.profiles WHERE id = v_user FOR UPDATE;
    v_new_elite := least(5, greatest(COALESCE(v_cur_elite, 0), v_row.reward_elite_vip_level));
    IF v_row.reward_elite_vip_days <= 0 OR (COALESCE(v_cur_elite, 0) >= 1 AND v_cur_elite_expires IS NULL) THEN
      v_new_elite_expires := NULL;
    ELSE
      v_new_elite_expires := greatest(COALESCE(v_cur_elite_expires, now()), now()) + make_interval(days => v_row.reward_elite_vip_days);
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
        v_igems := COALESCE((v_item->>'gems')::int, 0);
        v_ixp := COALESCE((v_item->>'xp')::int, 0);
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
          ON CONFLICT (user_id, item_type, item_id)
            WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
            DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
        END IF;
      ELSIF v_t = 'ship' THEN
        v_iid := v_item->>'item_id';
        IF v_iid IS NOT NULL THEN
          SELECT id INTO v_template_id FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          IF v_template_id IS NOT NULL THEN
            FOR i IN 1..v_iqty LOOP
              PERFORM public.buy_ship_by_code(v_iid, v_template_id, 0, 100000);
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.redemption_codes SET uses_count = uses_count + 1 WHERE id = v_row.id;
  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_row.id, v_user);

  IF v_vip_pts > 0 THEN
    PERFORM public.grant_vip_points(v_user, v_vip_pts::integer);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_row.code,
    'reward_type', v_row.reward_type,
    'item_id', v_row.item_id,
    'item_kind', v_row.item_kind,
    'reward_coins', COALESCE(v_row.reward_coins, 0),
    'reward_gems', COALESCE(v_row.reward_gems, 0),
    'reward_xp', COALESCE(v_row.reward_xp, 0),
    'reward_vip_level', COALESCE(v_row.reward_vip_level, 0),
    'reward_vip_days', COALESCE(v_row.reward_vip_days, 0),
    'reward_elite_vip_level', COALESCE(v_row.reward_elite_vip_level, 0),
    'reward_elite_vip_days', COALESCE(v_row.reward_elite_vip_days, 0),
    'quantity', v_qty,
    'extra_rewards', COALESCE(v_row.extra_rewards, '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.redeem_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.redeem_code(text) TO authenticated;