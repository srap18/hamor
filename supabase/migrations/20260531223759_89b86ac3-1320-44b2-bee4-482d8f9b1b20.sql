
-- Add extra_rewards JSONB column to redemption_codes for multi-reward codes
ALTER TABLE public.redemption_codes
  ADD COLUMN IF NOT EXISTS extra_rewards JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Update redeem_code to process extra_rewards bundle (in addition to the main reward)
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_row FROM public.redemption_codes
   WHERE code = upper(trim(p_code)) FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF NOT v_row.active THEN RAISE EXCEPTION 'code_disabled'; END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF v_row.max_uses > 0 AND v_row.uses_count >= v_row.max_uses THEN RAISE EXCEPTION 'code_exhausted'; END IF;
  IF EXISTS (SELECT 1 FROM public.code_redemptions WHERE code_id = v_row.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  v_qty := GREATEST(v_row.quantity, 1);

  -- Process the primary reward (kept for backward compatibility)
  IF v_row.reward_type = 'bundle' THEN
    UPDATE public.profiles
       SET coins = coins + v_row.reward_coins,
           gems  = gems  + v_row.reward_gems,
           xp    = xp    + v_row.reward_xp
     WHERE id = v_user;
    v_vip_pts := v_vip_pts + (v_row.reward_gems * 10) + (v_row.reward_coins / 100) + (v_row.reward_xp / 100);

  ELSIF v_row.reward_type = 'item' AND v_row.item_id IS NOT NULL THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, COALESCE(v_row.item_kind, 'misc'), v_row.item_id, v_qty);
    SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
      FROM public.items_catalog WHERE code = v_row.item_id LIMIT 1;
    v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_qty;

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

  -- Process extra_rewards array (multi-reward bundle)
  IF v_row.extra_rewards IS NOT NULL AND jsonb_array_length(v_row.extra_rewards) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_row.extra_rewards) LOOP
      v_t := COALESCE(v_item->>'type', '');
      v_iid := v_item->>'item_id';
      v_ikind := v_item->>'item_kind';
      v_iqty := GREATEST(COALESCE((v_item->>'quantity')::int, 1), 1);
      v_icoins := COALESCE((v_item->>'coins')::bigint, 0);
      v_igems := COALESCE((v_item->>'gems')::int, 0);
      v_ixp := COALESCE((v_item->>'xp')::int, 0);

      IF v_t = 'bundle' THEN
        UPDATE public.profiles
           SET coins = coins + v_icoins,
               gems  = gems  + v_igems,
               xp    = xp    + v_ixp
         WHERE id = v_user;
        v_vip_pts := v_vip_pts + (v_igems * 10) + (v_icoins / 100) + (v_ixp / 100);

      ELSIF v_t = 'item' AND v_iid IS NOT NULL THEN
        INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user, COALESCE(v_ikind, 'misc'), v_iid, v_iqty);
        SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
          FROM public.items_catalog WHERE code = v_iid LIMIT 1;
        v_vip_pts := v_vip_pts + ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * v_iqty;

      ELSIF v_t = 'ship' AND v_iid IS NOT NULL THEN
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
    END LOOP;
  END IF;

  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_row.id, v_user);
  UPDATE public.redemption_codes SET uses_count = uses_count + 1 WHERE id = v_row.id;

  PERFORM public.add_vip_points(v_user, v_vip_pts);

  RETURN jsonb_build_object(
    'ok', true,
    'reward_type', v_row.reward_type,
    'item_id', v_row.item_id,
    'reward_coins', v_row.reward_coins,
    'reward_gems', v_row.reward_gems,
    'reward_xp', v_row.reward_xp,
    'quantity', v_qty,
    'extra_rewards', v_row.extra_rewards,
    'vip_points_earned', v_vip_pts
  );
END;
$function$;
