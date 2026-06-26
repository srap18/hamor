-- Fix: when a user buys vip_monthly (or any pack with vipDays>0) through Paddle,
-- grant_paddle_purchase only extended protection_until but never activated vip_level / vip_expires_at,
-- so the VIP badge never appeared even though the user paid.
-- This update also sets vip_level (=1 if not already VIP) and extends vip_expires_at, mirroring grant_vip.

CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer,
  _shield_days integer, _vip_days integer, _env text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
  v_shield_item text;
  v_shield_qty int;
  v_cur_vip_level int;
  v_cur_vip_expires timestamptz;
  v_new_vip_expires timestamptz;
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
    -- Extend shield-style protection (existing behavior)
    UPDATE public.profiles
       SET protection_until = greatest(coalesce(protection_until, now()), now()) + (_vip_days || ' days')::interval
     WHERE id = _user;

    -- NEW: also activate the VIP badge (vip_level >= 1) and extend vip_expires_at
    SELECT vip_level, vip_expires_at INTO v_cur_vip_level, v_cur_vip_expires
      FROM public.profiles WHERE id = _user;

    -- Permanent if current VIP is already permanent
    IF COALESCE(v_cur_vip_level,0) >= 1 AND v_cur_vip_expires IS NULL THEN
      v_new_vip_expires := NULL;
    ELSE
      v_new_vip_expires := GREATEST(COALESCE(v_cur_vip_expires, now()), now())
                           + make_interval(days => _vip_days);
    END IF;

    UPDATE public.profiles
       SET vip_level = GREATEST(COALESCE(vip_level,0), 1),
           vip_expires_at = v_new_vip_expires
     WHERE id = _user;
  END IF;

  PERFORM public.add_vip_points(_user, coalesce(_amount_cents, 0)::bigint);

  RETURN jsonb_build_object('ok', true, 'pack_id', _pack_id, 'vip_points_earned', coalesce(_amount_cents,0));
END $function$;