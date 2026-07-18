
CREATE OR REPLACE FUNCTION public.grant_referral_bonus(_user uuid, _txn_id text, _amount_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inviter uuid;
  v_bonus int;
  v_inviter_name text;
  v_invitee_name text;
  v_has_signup bool;
  v_is_blocked bool;
  v_same_device bool;
BEGIN
  IF _user IS NULL OR _amount_cents <= 0 THEN RETURN; END IF;

  SELECT referred_by INTO v_inviter FROM public.profiles WHERE id = _user;
  IF v_inviter IS NULL OR v_inviter = _user THEN RETURN; END IF;

  -- Guard: purchase bonus only if the clean signup reward still exists
  SELECT EXISTS(
    SELECT 1 FROM public.referral_earnings
     WHERE inviter_id = v_inviter AND invitee_id = _user AND kind = 'signup'
  ) INTO v_has_signup;
  IF NOT v_has_signup THEN RETURN; END IF;

  -- Guard: not in the blocked-attempts list
  SELECT EXISTS(
    SELECT 1 FROM public.referral_blocked_attempts
     WHERE inviter_id = v_inviter AND invitee_id = _user
  ) INTO v_is_blocked;
  IF v_is_blocked THEN RETURN; END IF;

  -- Guard: same-device abuse (inviter and invitee share any device)
  SELECT EXISTS(
    SELECT 1 FROM public.device_accounts da1
    JOIN public.device_accounts da2 ON da1.device_id = da2.device_id
    WHERE da1.user_id = v_inviter AND da2.user_id = _user
  ) INTO v_same_device;
  IF v_same_device THEN
    -- Log it once so it doesn't retry forever
    INSERT INTO public.referral_blocked_attempts(inviter_id, invitee_id, reason)
    VALUES (v_inviter, _user, 'same_device_purchase')
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;

  v_bonus := floor(_amount_cents::numeric * 0.30)::int;
  IF v_bonus <= 0 THEN RETURN; END IF;

  BEGIN
    INSERT INTO public.referral_earnings(inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind)
    VALUES (v_inviter, _user, _txn_id, _amount_cents, v_bonus, 'purchase');
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  UPDATE public.profiles SET gems = gems + v_bonus WHERE id = v_inviter;

  SELECT display_name INTO v_invitee_name FROM public.profiles WHERE id = _user;
  SELECT display_name INTO v_inviter_name FROM public.profiles WHERE id = v_inviter;

  INSERT INTO public.notifications(recipient_id, kind, title, body, meta)
  VALUES (
    v_inviter,
    'referral_bonus',
    '🎉 مبروك! صديقك شحن',
    '🎁 صديقك ' || COALESCE(v_invitee_name,'') || ' شحن في اللعبة وحصلت على ' || v_bonus || ' 💎 مكافأة الدعوة (30%)',
    jsonb_build_object('invitee_id', _user, 'gems', v_bonus, 'amount_cents', _amount_cents, 'celebrate', true)
  );
END;
$function$;

-- Ensure the blocked_attempts reason column allows our value
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='referral_blocked_attempts' AND column_name='reason'
  ) THEN
    ALTER TABLE public.referral_blocked_attempts ADD COLUMN reason text;
  END IF;
END $$;
