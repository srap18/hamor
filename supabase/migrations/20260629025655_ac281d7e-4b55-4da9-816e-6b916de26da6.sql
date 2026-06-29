
-- 1) Make grant_paddle_purchase atomically award the referral bonus
CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer, _shield_days integer,
  _vip_days integer, _env text)
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
  v_elite_level int;
  v_elite_expires timestamptz;
  v_cur_elite_level int;
  v_cur_elite_expires timestamptz;
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
    UPDATE public.profiles
       SET protection_until = greatest(coalesce(protection_until, now()), now()) + (_vip_days || ' days')::interval
     WHERE id = _user;

    SELECT vip_level, vip_expires_at INTO v_cur_vip_level, v_cur_vip_expires
      FROM public.profiles WHERE id = _user;

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

  IF _pack_id ~ '^elite_vip_[1-5]_monthly$' THEN
    v_elite_level := substring(_pack_id from 'elite_vip_([1-5])_monthly')::int;
    SELECT elite_vip_level, elite_vip_expires_at
      INTO v_cur_elite_level, v_cur_elite_expires
      FROM public.profiles WHERE id = _user;

    v_elite_expires := GREATEST(COALESCE(v_cur_elite_expires, now()), now())
                       + make_interval(days => 30);

    UPDATE public.profiles
       SET elite_vip_level = GREATEST(COALESCE(elite_vip_level, 0), v_elite_level),
           elite_vip_expires_at = v_elite_expires
     WHERE id = _user;
  END IF;

  PERFORM public.add_vip_points(_user, coalesce(_amount_cents, 0)::bigint);

  -- CRITICAL: Pay referral bonus in the same transaction so it can never be skipped.
  IF coalesce(_amount_cents, 0) > 0 THEN
    BEGIN
      PERFORM public.grant_referral_bonus(_user, _txn_id, _amount_cents);
    EXCEPTION WHEN OTHERS THEN
      -- Don't fail the grant if bonus has a hiccup; log via notification to admin-side later.
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'pack_id', _pack_id, 'vip_points_earned', coalesce(_amount_cents,0));
END $function$;

-- 2) Backfill: for every past granted paddle purchase where buyer has referred_by
--    but no referral_earnings row exists, run grant_referral_bonus now.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pp.user_id, pp.paddle_transaction_id, pp.amount_cents
    FROM public.paddle_purchases pp
    JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.granted = true
      AND pp.amount_cents > 0
      AND p.referred_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.referral_earnings re
        WHERE re.txn_id = pp.paddle_transaction_id
      )
  LOOP
    BEGIN
      PERFORM public.grant_referral_bonus(r.user_id, r.paddle_transaction_id, r.amount_cents);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
