
DROP FUNCTION IF EXISTS public.apply_referral_code(text);
DROP FUNCTION IF EXISTS public.apply_referral_code(text, text);

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me uuid := auth.uid();
  v_inviter uuid;
  v_current uuid;
  v_matched text;
  v_reason text;
  v_req_ip text;
  v_clean_count int;
  v_today_count int;
  v_signup_gems constant int := 500;
  v_milestone_gems constant int := 2000;
  v_milestone_target constant int := 10;
  v_lifetime_cap constant int := 10;
  v_daily_cap constant int := 3;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF p_code IS NULL OR length(trim(p_code)) < 4 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF p_device_id IS NULL OR length(p_device_id) < 8 OR length(p_device_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'device_required');
  END IF;

  SELECT referred_by INTO v_current FROM public.profiles WHERE id = v_me;
  IF v_current IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_referred'); END IF;

  SELECT id INTO v_inviter FROM public.profiles WHERE upper(referral_code) = upper(trim(p_code)) LIMIT 1;
  IF v_inviter IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found'); END IF;
  IF v_inviter = v_me THEN RETURN jsonb_build_object('ok', false, 'reason', 'self_referral'); END IF;

  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings
   WHERE inviter_id = v_inviter AND kind = 'signup';
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

  BEGIN
    v_req_ip := coalesce(
      split_part(current_setting('request.headers', true)::json->>'cf-connecting-ip', ',', 1),
      split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1),
      current_setting('request.headers', true)::json->>'x-real-ip'
    );
    v_req_ip := nullif(trim(v_req_ip), '');
  EXCEPTION WHEN OTHERS THEN v_req_ip := NULL;
  END;

  IF v_req_ip IS NOT NULL AND length(v_req_ip) BETWEEN 3 AND 64 THEN
    INSERT INTO public.user_ips(user_id, ip, first_seen, last_seen, hits)
    VALUES (v_me, v_req_ip, now(), now(), 1)
    ON CONFLICT (user_id, ip) DO UPDATE SET last_seen = now(), hits = public.user_ips.hits + 1;
  END IF;
  INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
  VALUES (p_device_id, v_me, now(), now(), 1)
  ON CONFLICT (device_id, user_id) DO UPDATE SET last_seen = now(), hits = public.device_history.hits + 1;

  SELECT a.device_id INTO v_matched
    FROM public.device_history a
    JOIN public.device_history b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
  IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

  IF v_reason IS NULL THEN
    SELECT device_id INTO v_matched FROM public.device_history
     WHERE user_id = v_inviter AND device_id = p_device_id LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'inviter_device_reuse'; END IF;
  END IF;

  IF v_reason IS NULL AND v_req_ip IS NOT NULL THEN
    SELECT a.ip INTO v_matched
      FROM public.user_ips a JOIN public.user_ips b ON a.ip = b.ip
     WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_ip'; END IF;
  END IF;

  IF v_reason IS NULL AND v_req_ip IS NOT NULL AND v_req_ip ~ '^\d+\.\d+\.\d+\.\d+$' THEN
    SELECT a.ip INTO v_matched
      FROM public.user_ips a
      JOIN public.user_ips b ON split_part(a.ip, '.', 1) = split_part(b.ip, '.', 1)
                            AND split_part(a.ip, '.', 2) = split_part(b.ip, '.', 2)
                            AND split_part(a.ip, '.', 3) = split_part(b.ip, '.', 3)
     WHERE a.user_id = v_inviter AND b.user_id = v_me
       AND a.ip ~ '^\d+\.\d+\.\d+\.\d+$' AND b.ip ~ '^\d+\.\d+\.\d+\.\d+$' LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_subnet'; END IF;
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

  IF v_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.referral_earnings e
        JOIN public.device_history dh ON dh.user_id = e.invitee_id
       WHERE e.inviter_id = v_inviter AND e.kind = 'signup' AND dh.device_id = p_device_id
    ) THEN
      v_matched := p_device_id; v_reason := 'device_already_used';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, v_reason, v_matched)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  UPDATE public.profiles SET referred_by = v_inviter, referral_locked_at = now()
    WHERE id = v_me AND referred_by IS NULL;

  INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
  VALUES (v_inviter, v_me, 'signup:' || v_me::text, 0, v_signup_gems, 'signup', 'مكافأة تسجيل صديق جديد')
  ON CONFLICT (txn_id, inviter_id) DO NOTHING;

  UPDATE public.profiles SET gems = gems + v_signup_gems WHERE id = v_inviter;

  v_clean_count := v_clean_count + 1;
  IF v_clean_count >= v_milestone_target THEN
    INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
    VALUES (v_inviter, v_me, 'milestone:10:' || v_inviter::text, 0, v_milestone_gems, 'milestone', 'مكافأة إنجاز 10 دعوات ناجحة')
    ON CONFLICT (txn_id, inviter_id) DO NOTHING;
    IF FOUND THEN
      UPDATE public.profiles SET gems = gems + v_milestone_gems WHERE id = v_inviter;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'inviter', v_inviter, 'signup_gems', v_signup_gems);
END;
$fn$;

-- Zero gems for exploiters
UPDATE public.profiles
   SET gems = 0
 WHERE id IN (
   SELECT re.inviter_id
     FROM public.referral_earnings re
    WHERE re.kind = 'signup'
    GROUP BY re.inviter_id
   HAVING COUNT(*) > 10
 );
