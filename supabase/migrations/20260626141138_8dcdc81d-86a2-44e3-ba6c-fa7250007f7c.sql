
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS purchases_blocked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.revoke_paddle_purchase(
  _txn_id text,
  _gems integer DEFAULT 0,
  _coins bigint DEFAULT 0,
  _rubies integer DEFAULT 0,
  _shield_days integer DEFAULT 0,
  _vip_days integer DEFAULT 0,
  _revoke_elite_level integer DEFAULT 0,
  _block_account boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row paddle_purchases%ROWTYPE;
  _user uuid;
BEGIN
  SELECT * INTO _row FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF _row.status = 'refunded' OR _row.granted = false THEN
    RETURN jsonb_build_object('ok', true, 'already_revoked', true);
  END IF;

  _user := _row.user_id;

  -- Deduct currencies (allow negative balances)
  UPDATE public.profiles
  SET
    gems   = gems   - COALESCE(_gems, 0),
    coins  = coins  - COALESCE(_coins, 0),
    rubies = rubies - COALESCE(_rubies, 0),
    protection_until = CASE
      WHEN COALESCE(_shield_days,0) > 0 THEN LEAST(COALESCE(protection_until, now()), now())
      ELSE protection_until
    END,
    vip_expires_at = CASE
      WHEN COALESCE(_vip_days,0) > 0 THEN LEAST(COALESCE(vip_expires_at, now()), now())
      ELSE vip_expires_at
    END,
    elite_vip_level = CASE
      WHEN COALESCE(_revoke_elite_level,0) > 0 THEN 0
      ELSE elite_vip_level
    END,
    elite_vip_expires_at = CASE
      WHEN COALESCE(_revoke_elite_level,0) > 0 THEN NULL
      ELSE elite_vip_expires_at
    END,
    purchases_blocked = CASE WHEN _block_account THEN true ELSE purchases_blocked END
  WHERE id = _user;

  -- Mark purchase as refunded
  UPDATE public.paddle_purchases
  SET status = 'refunded', granted = false
  WHERE paddle_transaction_id = _txn_id;

  -- Notify the player
  INSERT INTO public.notifications (recipient_id, title, body, kind, meta)
  VALUES (
    _user,
    'تم سحب مكافآت شراء مسترد',
    'تم استرداد مبلغ عملية شراء سابقة، وبموجب سياسة الاسترداد تم سحب جميع المكافآت الممنوحة (قد يصبح رصيدك بالسالب حتى يُعوَّض). تم تعليق إمكانية الشراء على حسابك.',
    'system',
    jsonb_build_object(
      'reason', 'paddle_refund_revocation',
      'paddle_transaction_id', _txn_id,
      'gems_revoked', COALESCE(_gems,0),
      'coins_revoked', COALESCE(_coins,0),
      'rubies_revoked', COALESCE(_rubies,0),
      'shield_revoked', COALESCE(_shield_days,0) > 0,
      'vip_revoked', COALESCE(_vip_days,0) > 0,
      'elite_revoked', COALESCE(_revoke_elite_level,0) > 0,
      'account_blocked', _block_account
    )
  );

  RETURN jsonb_build_object('ok', true, 'user_id', _user, 'blocked', _block_account);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_paddle_purchase(text, integer, bigint, integer, integer, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_paddle_purchase(text, integer, bigint, integer, integer, integer, integer, boolean) TO service_role;
