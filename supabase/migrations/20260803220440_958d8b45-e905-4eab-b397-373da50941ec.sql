CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(_txn_id text, _user uuid, _pack_id text, _amount_cents integer, _gems integer, _coins bigint, _rubies integer, _shield_days integer, _vip_days integer, _env text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
  v_shield_item text;
  v_shield_qty  int;
  v_elite_level int;
  v_elite_expires timestamptz;
  v_blocked boolean;
BEGIN
  SELECT purchases_blocked INTO v_blocked FROM public.profiles WHERE id = _user;
  IF coalesce(v_blocked, false) THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true, 'reason', 'purchases_blocked');
  END IF;

  SELECT * INTO v_existing FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;
  IF found AND v_existing.granted THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'pack_id', v_existing.pack_id);
  END IF;

  INSERT INTO public.paddle_purchases (
    user_id, paddle_transaction_id, pack_id, status, amount_cents,
    granted, granted_at, environment,
    granted_gems, granted_coins, granted_rubies, granted_shield_days, granted_vip_days
  )
  VALUES (
    _user, _txn_id, _pack_id, 'paid', _amount_cents,
    true, now(), _env,
    coalesce(_gems,0), coalesce(_coins,0), coalesce(_rubies,0),
    coalesce(_shield_days,0), coalesce(_vip_days,0)
  )
  ON CONFLICT (paddle_transaction_id) DO UPDATE
    SET status = 'paid',
        granted = true,
        granted_at = now(),
        granted_gems        = EXCLUDED.granted_gems,
        granted_coins       = EXCLUDED.granted_coins,
        granted_rubies      = EXCLUDED.granted_rubies,
        granted_shield_days = EXCLUDED.granted_shield_days,
        granted_vip_days    = EXCLUDED.granted_vip_days;

  IF coalesce(_gems,0) > 0 OR coalesce(_coins,0) > 0 OR coalesce(_rubies,0) > 0 THEN
    UPDATE public.profiles
       SET gems   = coalesce(gems,0)   + coalesce(_gems,0),
           coins  = coalesce(coins,0)  + coalesce(_coins,0),
           rubies = coalesce(rubies,0) + coalesce(_rubies,0)
     WHERE id = _user;

    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'currency', jsonb_build_object(
      'gems',   coalesce(_gems,0),
      'coins',  coalesce(_coins,0),
      'rubies', coalesce(_rubies,0),
      'amount_cents', coalesce(_amount_cents,0),
      'env', _env
    ));
  END IF;

  IF coalesce(_shield_days,0) > 0 THEN
    IF _shield_days >= 30 AND _shield_days % 30 = 0 THEN
      v_shield_item := 'shield_30d'; v_shield_qty := _shield_days / 30;
    ELSIF _shield_days >= 7 AND _shield_days % 7 = 0 THEN
      v_shield_item := 'shield_7d';  v_shield_qty := _shield_days / 7;
    ELSE
      v_shield_item := 'shield_1d';  v_shield_qty := _shield_days;
    END IF;
    PERFORM public.grant_inventory_item(_user, 'shield', v_shield_item, v_shield_qty);
    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'shield', jsonb_build_object(
      'item_id', v_shield_item, 'qty', v_shield_qty, 'shield_days', _shield_days
    ));
  END IF;

  IF coalesce(_vip_days,0) > 0 THEN
    UPDATE public.profiles
       SET vip_expires_at = GREATEST(coalesce(vip_expires_at, now()), now()) + make_interval(days => _vip_days)
     WHERE id = _user;
    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'vip', jsonb_build_object(
      'vip_days', _vip_days
    ));
  END IF;

  v_elite_level := CASE
    WHEN _pack_id ~ '^elite_vip_[1-5]_monthly$'
      THEN substring(_pack_id from 'elite_vip_([1-5])_monthly')::int
    ELSE NULL
  END;
  IF v_elite_level IS NOT NULL THEN
    v_elite_expires := now() + interval '30 days';
    UPDATE public.profiles
       SET elite_vip_level = CASE
             WHEN coalesce(elite_vip_expires_at, now()) > now()
               THEN GREATEST(coalesce(elite_vip_level, 0), v_elite_level)
             ELSE v_elite_level
           END,
           elite_vip_expires_at = GREATEST(coalesce(elite_vip_expires_at, now()), v_elite_expires)
     WHERE id = _user;
    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'elite_vip', jsonb_build_object(
      'level', v_elite_level, 'expires_at', v_elite_expires
    ));
  END IF;

  BEGIN
    INSERT INTO public.economy_audit (user_id, reason, ref, gems_delta, coins_delta, rubies_delta, meta)
    VALUES (
      _user, 'paddle_grant', _txn_id,
      coalesce(_gems,0), coalesce(_coins,0), coalesce(_rubies,0),
      jsonb_build_object('pack_id', _pack_id, 'env', _env, 'amount_cents', _amount_cents)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'granted', true, 'pack_id', _pack_id);
END;
$function$;

UPDATE public.profiles SET elite_vip_level = 5 WHERE id = 'a01cd74e-6bff-4ae2-9539-74cb5760566c';