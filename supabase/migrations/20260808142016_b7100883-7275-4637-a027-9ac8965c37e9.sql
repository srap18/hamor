
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_inviter uuid;
  v_current uuid;
  v_matched text;
  v_reason text;
  v_clean_count int;
  v_today_count int;
  v_lifetime_cap constant int := 10;
  v_daily_cap constant int := 3;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF NOT public.is_email_verified(v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_not_verified');
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) < 4 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF p_device_id IS NULL OR length(p_device_id) < 32 OR length(p_device_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'device_required');
  END IF;

  SELECT referred_by INTO v_current FROM public.profiles WHERE id = v_me;
  IF v_current IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_referred'); END IF;

  SELECT id INTO v_inviter FROM public.profiles WHERE upper(referral_code) = upper(trim(p_code)) LIMIT 1;
  IF v_inviter IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found'); END IF;
  IF v_inviter = v_me THEN RETURN jsonb_build_object('ok', false, 'reason', 'self_referral'); END IF;

  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings WHERE inviter_id = v_inviter AND kind = 'signup';
  IF v_clean_count >= v_lifetime_cap THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'lifetime_cap_reached', v_clean_count::text)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'lifetime_cap_reached');
  END IF;

  SELECT count(*) INTO v_today_count
    FROM public.referral_earnings
   WHERE inviter_id = v_inviter AND kind = 'signup'
     AND created_at >= (now() - interval '24 hours');
  IF v_today_count >= v_daily_cap THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'daily_cap_reached', v_today_count::text)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap_reached');
  END IF;

  INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
  VALUES (p_device_id, v_me, now(), now(), 1)
  ON CONFLICT (device_id, user_id) DO UPDATE SET last_seen = now(), hits = public.device_history.hits + 1;

  -- exact hardware hash seen for both accounts
  SELECT a.device_id INTO v_matched
    FROM public.device_history a
    JOIN public.device_history b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me AND length(a.device_id) >= 32
   LIMIT 1;
  IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

  -- resolved hardware identity (survives incognito / cleared storage)
  IF v_reason IS NULL THEN
    SELECT a.identity_id::text INTO v_matched
      FROM public.device_identity_users a
      JOIN public.device_identity_users b ON a.identity_id = b.identity_id
     WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
  END IF;

  -- device slots (physical device -> accounts)
  IF v_reason IS NULL THEN
    SELECT a.hardware_hash INTO v_matched
      FROM public.device_slots a
      JOIN public.device_slots b ON a.hardware_hash = b.hardware_hash
     WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
  END IF;

  -- this device already earned a referral for this inviter
  IF v_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.referral_earnings e
        JOIN public.device_history dh ON dh.user_id = e.invitee_id
       WHERE e.inviter_id = v_inviter AND e.kind = 'signup'
         AND dh.device_id = p_device_id AND length(dh.device_id) >= 32
    ) THEN
      v_matched := p_device_id; v_reason := 'device_already_used';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.referral_earnings e
        JOIN public.device_slots ds ON ds.user_id = e.invitee_id
        JOIN public.device_slots mine ON mine.hardware_hash = ds.hardware_hash
       WHERE e.inviter_id = v_inviter AND e.kind = 'signup' AND mine.user_id = v_me
    ) THEN
      v_reason := 'device_already_used';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    BEGIN
      SELECT a.provider_id INTO v_matched
        FROM public.account_links a
        JOIN public.account_links b ON a.provider = b.provider AND a.provider_id = b.provider_id
       WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'linked_account'; END IF;
    EXCEPTION WHEN undefined_column OR undefined_table THEN v_matched := NULL;
    END;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, v_reason, v_matched)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  UPDATE public.profiles SET referred_by = v_inviter WHERE id = v_me AND referred_by IS NULL;

  PERFORM public.award_pending_referral_if_qualified(v_me);

  RETURN jsonb_build_object('ok', true, 'pending', true);
END;
$function$;
