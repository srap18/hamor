
ALTER TABLE public.paddle_purchases
  ADD COLUMN IF NOT EXISTS granted_gems        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS granted_coins       bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS granted_rubies      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS granted_shield_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS granted_vip_days    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_banned_at    timestamptz;

CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer,
  _shield_days integer, _vip_days integer, _env text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
       SET gems   = gems   + coalesce(_gems,0),
           coins  = coins  + coalesce(_coins,0),
           rubies = rubies + coalesce(_rubies,0)
     WHERE id = _user;
  END IF;

  IF coalesce(_shield_days,0) > 0 THEN
    IF _shield_days >= 30 AND (_shield_days % 30) = 0 THEN
      v_shield_item := 'shield_30d'; v_shield_qty := _shield_days / 30;
    ELSIF _shield_days >= 7 AND (_shield_days % 7) = 0 THEN
      v_shield_item := 'shield_7d';  v_shield_qty := _shield_days / 7;
    ELSE
      v_shield_item := 'shield_1d';  v_shield_qty := _shield_days;
    END IF;
    PERFORM public.grant_inventory_item(_user, 'shield', v_shield_item, v_shield_qty);
  END IF;

  IF coalesce(_vip_days,0) > 0 THEN
    UPDATE public.profiles
       SET vip_expires_at = GREATEST(coalesce(vip_expires_at, now()), now()) + make_interval(days => _vip_days)
     WHERE id = _user;
  END IF;

  v_elite_level := CASE
    WHEN _pack_id ~ '^elite_vip_[1-5]_monthly$'
      THEN substring(_pack_id from 'elite_vip_([1-5])_monthly')::int
    ELSE NULL
  END;
  IF v_elite_level IS NOT NULL THEN
    v_elite_expires := now() + interval '30 days';
    UPDATE public.profiles
       SET elite_vip_level = v_elite_level,
           elite_vip_expires_at = GREATEST(coalesce(elite_vip_expires_at, now()), v_elite_expires)
     WHERE id = _user;
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
$$;

CREATE OR REPLACE FUNCTION public.refund_ban_user(
  _txn_id text,
  _reason text DEFAULT 'chargeback/refund on digital instant delivery'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid;
  v_pack text;
  v_gems integer;
  v_coins bigint;
  v_rubies integer;
  v_device_count int := 0;
BEGIN
  SELECT user_id, pack_id, granted_gems, granted_coins, granted_rubies
    INTO v_user, v_pack, v_gems, v_coins, v_rubies
  FROM public.paddle_purchases
  WHERE paddle_transaction_id = _txn_id
  FOR UPDATE;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'txn_not_found');
  END IF;

  UPDATE public.paddle_purchases
     SET status = 'refunded',
         granted = false,
         refund_banned_at = now()
   WHERE paddle_transaction_id = _txn_id;

  UPDATE public.profiles
     SET gems   = gems   - coalesce(v_gems,0),
         coins  = coins  - coalesce(v_coins,0),
         rubies = rubies - coalesce(v_rubies,0),
         purchases_blocked = true,
         elite_vip_level = 0,
         elite_vip_expires_at = NULL,
         vip_expires_at = LEAST(coalesce(vip_expires_at, now()), now()),
         protection_until = LEAST(coalesce(protection_until, now()), now())
   WHERE id = v_user;

  UPDATE public.bans SET active = false WHERE user_id = v_user AND active = true;
  INSERT INTO public.bans (user_id, reason, active, expires_at)
  VALUES (v_user, 'REFUND/CHARGEBACK: ' || coalesce(_reason,''), true, NULL);

  INSERT INTO public.banned_devices (device_id, user_id, reason)
  SELECT da.device_id, v_user, 'refund_ban:' || _txn_id
    FROM public.device_accounts da
   WHERE da.user_id = v_user
  ON CONFLICT (device_id) DO NOTHING;
  GET DIAGNOSTICS v_device_count = ROW_COUNT;

  BEGIN
    INSERT INTO public.economy_audit (user_id, reason, ref, gems_delta, coins_delta, rubies_delta, meta)
    VALUES (
      v_user, 'refund_ban', _txn_id,
      -coalesce(v_gems,0), -coalesce(v_coins,0), -coalesce(v_rubies,0),
      jsonb_build_object('pack_id', v_pack, 'devices_banned', v_device_count, 'policy', 'no_refunds')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user,
    'gems_revoked', v_gems,
    'devices_banned', v_device_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_ban_user(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refund_ban_user(text, text) TO service_role;

UPDATE public.paddle_purchases pp
   SET granted_gems  = coalesce(sp.gems, 0),
       granted_coins = coalesce(sp.coins, 0)
  FROM (VALUES
    ('offer_gems_550_15off',   575,  0),
    ('offer_gems_1250_15off',  1150, 0),
    ('offer_gems_2800_15off',  4600, 0),
    ('offer_gems_7500_15off',  34500,0),
    ('gp_100',   100,  0),
    ('gp_575',   575,  0),
    ('gp_1250',  1250, 0),
    ('gp_2800',  2800, 0),
    ('gp_4500',  4500, 0),
    ('gp_7500',  7500, 0)
  ) AS sp(pack_id, gems, coins)
 WHERE pp.pack_id = sp.pack_id
   AND pp.granted = true
   AND pp.granted_gems = 0;
