
-- Fix referral abuse: check device_history (populated by touch_session) instead of
-- device_accounts (empty since device-binding was disabled), and also check the
-- client-supplied device_id + request IP immediately so the invitee's device is
-- caught before touch_session runs.

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_inviter uuid;
  v_current uuid;
  v_shared_ip text;
  v_shared_device text;
  v_req_ip text;
  v_clean_count int;
  v_signup_gems constant int := 500;
  v_milestone_gems constant int := 2000;
  v_milestone_target constant int := 10;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT referred_by INTO v_current FROM public.profiles WHERE id = v_me;
  IF v_current IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;

  SELECT id INTO v_inviter FROM public.profiles
   WHERE upper(referral_code) = upper(trim(p_code)) LIMIT 1;
  IF v_inviter IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found');
  END IF;
  IF v_inviter = v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  -- Request IP (best-effort, from PostgREST headers)
  BEGIN
    v_req_ip := coalesce(
      split_part(current_setting('request.headers', true)::json->>'cf-connecting-ip', ',', 1),
      split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1),
      current_setting('request.headers', true)::json->>'x-real-ip'
    );
    v_req_ip := nullif(trim(v_req_ip), '');
  EXCEPTION WHEN OTHERS THEN v_req_ip := NULL;
  END;

  -- Record current IP + device for the invitee up front so the checks below have data
  IF v_req_ip IS NOT NULL AND length(v_req_ip) BETWEEN 3 AND 64 THEN
    INSERT INTO public.user_ips(user_id, ip, first_seen, last_seen, hits)
    VALUES (v_me, v_req_ip, now(), now(), 1)
    ON CONFLICT (user_id, ip) DO UPDATE
      SET last_seen = now(), hits = public.user_ips.hits + 1;
  END IF;

  IF p_device_id IS NOT NULL AND length(p_device_id) BETWEEN 8 AND 160 THEN
    INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
    VALUES (p_device_id, v_me, now(), now(), 1)
    ON CONFLICT (device_id, user_id) DO UPDATE
      SET last_seen = now(), hits = public.device_history.hits + 1;
  END IF;

  -- Security check: shared IP (either historical, or the current request IP)
  SELECT a.ip INTO v_shared_ip
    FROM public.user_ips a
    JOIN public.user_ips b ON a.ip = b.ip
   WHERE a.user_id = v_inviter AND b.user_id = v_me
   LIMIT 1;

  IF v_shared_ip IS NULL AND v_req_ip IS NOT NULL THEN
    SELECT ip INTO v_shared_ip
      FROM public.user_ips
     WHERE user_id = v_inviter AND ip = v_req_ip
     LIMIT 1;
  END IF;

  IF v_shared_ip IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'same_ip', v_shared_ip)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'same_ip');
  END IF;

  -- Security check: shared device (device_history covers every device a user has ever used;
  -- device_accounts is only populated when device-binding is enforced, which it currently isn't)
  SELECT a.device_id INTO v_shared_device
    FROM public.device_history a
    JOIN public.device_history b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me
   LIMIT 1;

  IF v_shared_device IS NULL AND p_device_id IS NOT NULL AND length(p_device_id) BETWEEN 8 AND 160 THEN
    SELECT device_id INTO v_shared_device
      FROM public.device_history
     WHERE user_id = v_inviter AND device_id = p_device_id
     LIMIT 1;
    IF v_shared_device IS NULL THEN
      SELECT device_id INTO v_shared_device
        FROM public.device_accounts
       WHERE user_id = v_inviter AND device_id = p_device_id
       LIMIT 1;
    END IF;
  END IF;

  IF v_shared_device IS NULL THEN
    -- Also cross-check the legacy device_accounts table
    SELECT a.device_id INTO v_shared_device
      FROM public.device_accounts a
      JOIN public.device_accounts b ON a.device_id = b.device_id
     WHERE a.user_id = v_inviter AND b.user_id = v_me
     LIMIT 1;
  END IF;

  IF v_shared_device IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'same_device', v_shared_device)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'same_device');
  END IF;

  -- All checks passed — lock referral
  UPDATE public.profiles
    SET referred_by = v_inviter, referral_locked_at = now()
    WHERE id = v_me AND referred_by IS NULL;

  -- Award instant signup reward to inviter (500 gems)
  INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
  VALUES (v_inviter, v_me, 'signup:' || v_me::text, 0, v_signup_gems, 'signup', 'مكافأة تسجيل صديق جديد')
  ON CONFLICT (txn_id, inviter_id) DO NOTHING;

  UPDATE public.profiles
     SET gems = gems + v_signup_gems
   WHERE id = v_inviter;

  -- Milestone bonus at 10 clean invites
  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings
   WHERE inviter_id = v_inviter AND kind = 'signup';

  IF v_clean_count >= v_milestone_target THEN
    INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
    VALUES (v_inviter, v_me, 'milestone:10:' || v_inviter::text, 0, v_milestone_gems, 'milestone', 'مكافأة إنجاز 10 دعوات ناجحة')
    ON CONFLICT (txn_id, inviter_id) DO NOTHING;

    IF FOUND THEN
      UPDATE public.profiles
         SET gems = gems + v_milestone_gems
       WHERE id = v_inviter;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'inviter', v_inviter, 'signup_gems', v_signup_gems);
END;
$function$;

-- Keep the old single-arg signature working (delegates to new one)
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.apply_referral_code($1, NULL::text);
$$;

GRANT EXECUTE ON FUNCTION public.apply_referral_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(text, text) TO authenticated;

-- Retro cleanup: revoke gems from past referrals that shared a device (via device_history)
-- or a currently-known IP. Deletes the earning rows, subtracts gems from the inviter,
-- clears referred_by on the invitee, and logs to referral_blocked_attempts.
DO $$
DECLARE
  r record;
  v_matched text;
  v_reason text;
BEGIN
  FOR r IN
    SELECT e.id, e.inviter_id, e.invitee_id, e.gems_awarded, e.txn_id
      FROM public.referral_earnings e
     WHERE e.kind = 'signup'
  LOOP
    v_matched := NULL; v_reason := NULL;

    -- shared device via device_history
    SELECT a.device_id INTO v_matched
      FROM public.device_history a
      JOIN public.device_history b ON a.device_id = b.device_id
     WHERE a.user_id = r.inviter_id AND b.user_id = r.invitee_id
     LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

    -- shared IP
    IF v_matched IS NULL THEN
      SELECT a.ip INTO v_matched
        FROM public.user_ips a
        JOIN public.user_ips b ON a.ip = b.ip
       WHERE a.user_id = r.inviter_id AND b.user_id = r.invitee_id
       LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_ip'; END IF;
    END IF;

    -- legacy device_accounts
    IF v_matched IS NULL THEN
      SELECT a.device_id INTO v_matched
        FROM public.device_accounts a
        JOIN public.device_accounts b ON a.device_id = b.device_id
       WHERE a.user_id = r.inviter_id AND b.user_id = r.invitee_id
       LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      -- refund gems from inviter (never below 0)
      UPDATE public.profiles
         SET gems = greatest(0, gems - r.gems_awarded)
       WHERE id = r.inviter_id;

      -- delete earning row so leaderboards/counters correct themselves
      DELETE FROM public.referral_earnings WHERE id = r.id;

      -- clear referred_by so future legit invites still work for this user
      UPDATE public.profiles
         SET referred_by = NULL, referral_locked_at = NULL
       WHERE id = r.invitee_id AND referred_by = r.inviter_id;

      INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
      VALUES (r.inviter_id, r.invitee_id, v_reason, v_matched)
      ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    END IF;
  END LOOP;
END$$;
