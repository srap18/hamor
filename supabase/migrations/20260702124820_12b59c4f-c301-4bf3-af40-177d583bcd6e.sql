
-- === STRICT REFERRAL RULES ===
-- Reject invite reward if ANY of the following is true:
--  * device_id missing/too short
--  * inviter+invitee share device_history OR device_accounts (any device ever seen)
--  * inviter+invitee share user_ips (any IP ever seen)
--  * shared IP /24 subnet (catches same-router NAT)
--  * shared account_links row (same linked identity)
--  * inviter previously invited from this device (one clean invite per device, all-time)

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
  v_matched text;
  v_reason text;
  v_req_ip text;
  v_req_subnet text;
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
  IF p_device_id IS NULL OR length(p_device_id) < 8 OR length(p_device_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'device_required');
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

  -- Request IP (best-effort from PostgREST headers)
  BEGIN
    v_req_ip := coalesce(
      split_part(current_setting('request.headers', true)::json->>'cf-connecting-ip', ',', 1),
      split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1),
      current_setting('request.headers', true)::json->>'x-real-ip'
    );
    v_req_ip := nullif(trim(v_req_ip), '');
  EXCEPTION WHEN OTHERS THEN v_req_ip := NULL;
  END;

  -- Record IP + device for invitee upfront
  IF v_req_ip IS NOT NULL AND length(v_req_ip) BETWEEN 3 AND 64 THEN
    INSERT INTO public.user_ips(user_id, ip, first_seen, last_seen, hits)
    VALUES (v_me, v_req_ip, now(), now(), 1)
    ON CONFLICT (user_id, ip) DO UPDATE
      SET last_seen = now(), hits = public.user_ips.hits + 1;
  END IF;
  INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
  VALUES (p_device_id, v_me, now(), now(), 1)
  ON CONFLICT (device_id, user_id) DO UPDATE
    SET last_seen = now(), hits = public.device_history.hits + 1;

  -- 1) Shared device via device_history (all-time)
  SELECT a.device_id INTO v_matched
    FROM public.device_history a
    JOIN public.device_history b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me
   LIMIT 1;
  IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

  -- 2) Client-supplied device matches any inviter device (belt-and-braces)
  IF v_reason IS NULL THEN
    SELECT device_id INTO v_matched
      FROM public.device_history
     WHERE user_id = v_inviter AND device_id = p_device_id
     LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
  END IF;

  -- 3) Legacy device_accounts
  IF v_reason IS NULL THEN
    SELECT a.device_id INTO v_matched
      FROM public.device_accounts a
      JOIN public.device_accounts b ON a.device_id = b.device_id
     WHERE a.user_id = v_inviter AND b.user_id = v_me
     LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
  END IF;

  -- 4) Shared IP (exact)
  IF v_reason IS NULL THEN
    SELECT a.ip INTO v_matched
      FROM public.user_ips a
      JOIN public.user_ips b ON a.ip = b.ip
     WHERE a.user_id = v_inviter AND b.user_id = v_me
     LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_ip'; END IF;
  END IF;

  -- 5) Shared /24 subnet (catches same-router NAT). Only if IP looks IPv4.
  IF v_reason IS NULL THEN
    SELECT split_part(a.ip, '.', 1) || '.' || split_part(a.ip, '.', 2) || '.' || split_part(a.ip, '.', 3) || '.0/24'
      INTO v_matched
      FROM public.user_ips a
      JOIN public.user_ips b
        ON split_part(a.ip, '.', 1) = split_part(b.ip, '.', 1)
       AND split_part(a.ip, '.', 2) = split_part(b.ip, '.', 2)
       AND split_part(a.ip, '.', 3) = split_part(b.ip, '.', 3)
     WHERE a.user_id = v_inviter AND b.user_id = v_me
       AND a.ip ~ '^\d+\.\d+\.\d+\.\d+$'
       AND b.ip ~ '^\d+\.\d+\.\d+\.\d+$'
     LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_subnet'; END IF;
  END IF;

  -- 6) Shared account_links (same identity provider link)
  IF v_reason IS NULL THEN
    BEGIN
      SELECT a.provider_id INTO v_matched
        FROM public.account_links a
        JOIN public.account_links b ON a.provider = b.provider AND a.provider_id = b.provider_id
       WHERE a.user_id = v_inviter AND b.user_id = v_me
       LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'linked_account'; END IF;
    EXCEPTION WHEN undefined_column OR undefined_table THEN v_matched := NULL;
    END;
  END IF;

  -- 7) This device already earned inviter a clean invite (all-time)
  IF v_reason IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.referral_earnings e
        JOIN public.device_history dh ON dh.user_id = e.invitee_id
       WHERE e.inviter_id = v_inviter
         AND e.kind = 'signup'
         AND dh.device_id = p_device_id
    ) THEN
      v_matched := p_device_id;
      v_reason := 'device_already_used';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, v_reason, v_matched)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  -- === All checks passed ===
  UPDATE public.profiles
    SET referred_by = v_inviter, referral_locked_at = now()
    WHERE id = v_me AND referred_by IS NULL;

  INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
  VALUES (v_inviter, v_me, 'signup:' || v_me::text, 0, v_signup_gems, 'signup', 'مكافأة تسجيل صديق جديد')
  ON CONFLICT (txn_id, inviter_id) DO NOTHING;

  UPDATE public.profiles
     SET gems = gems + v_signup_gems
   WHERE id = v_inviter;

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

-- Purchase-based referral bonus: also block if the signup earning was revoked
-- (i.e. the invitee/inviter later flagged as fraudulent).
CREATE OR REPLACE FUNCTION public.grant_referral_bonus(
  _user uuid,
  _txn_id text,
  _amount_cents integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inviter uuid;
  v_bonus int;
  v_inviter_name text;
  v_invitee_name text;
  v_has_signup bool;
  v_is_blocked bool;
BEGIN
  IF _user IS NULL OR _amount_cents <= 0 THEN RETURN; END IF;

  SELECT referred_by INTO v_inviter FROM public.profiles WHERE id = _user;
  IF v_inviter IS NULL THEN RETURN; END IF;

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

  v_bonus := floor(_amount_cents::numeric * 0.30)::int;
  IF v_bonus <= 0 THEN RETURN; END IF;

  BEGIN
    INSERT INTO public.referral_earnings(inviter_id, invitee_id, txn_id, amount_cents, gems_awarded)
    VALUES (v_inviter, _user, _txn_id, _amount_cents, v_bonus);
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
    '🎁 مكافأة دعوة!',
    'صديقك ' || COALESCE(v_invitee_name,'') || ' شحن في اللعبة وحصلت على ' || v_bonus || ' 💎',
    jsonb_build_object('invitee_id', _user, 'gems', v_bonus, 'amount_cents', _amount_cents)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_referral_bonus(uuid, text, integer) TO service_role;

-- Retro sweep using the STRICTER rules (device_history, subnet, account_links)
DO $$
DECLARE
  r record;
  v_matched text;
  v_reason text;
BEGIN
  FOR r IN
    SELECT e.id, e.inviter_id, e.invitee_id, e.gems_awarded
      FROM public.referral_earnings e
     WHERE e.kind = 'signup'
  LOOP
    v_matched := NULL; v_reason := NULL;

    SELECT a.device_id INTO v_matched
      FROM public.device_history a
      JOIN public.device_history b ON a.device_id = b.device_id
     WHERE a.user_id = r.inviter_id AND b.user_id = r.invitee_id LIMIT 1;
    IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

    IF v_reason IS NULL THEN
      SELECT a.device_id INTO v_matched
        FROM public.device_accounts a
        JOIN public.device_accounts b ON a.device_id = b.device_id
       WHERE a.user_id = r.inviter_id AND b.user_id = r.invitee_id LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
    END IF;

    IF v_reason IS NULL THEN
      SELECT a.ip INTO v_matched
        FROM public.user_ips a
        JOIN public.user_ips b ON a.ip = b.ip
       WHERE a.user_id = r.inviter_id AND b.user_id = r.invitee_id LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_ip'; END IF;
    END IF;

    IF v_reason IS NULL THEN
      SELECT split_part(a.ip,'.',1)||'.'||split_part(a.ip,'.',2)||'.'||split_part(a.ip,'.',3)||'.0/24'
        INTO v_matched
        FROM public.user_ips a
        JOIN public.user_ips b
          ON split_part(a.ip,'.',1)=split_part(b.ip,'.',1)
         AND split_part(a.ip,'.',2)=split_part(b.ip,'.',2)
         AND split_part(a.ip,'.',3)=split_part(b.ip,'.',3)
       WHERE a.user_id=r.inviter_id AND b.user_id=r.invitee_id
         AND a.ip ~ '^\d+\.\d+\.\d+\.\d+$' AND b.ip ~ '^\d+\.\d+\.\d+\.\d+$'
       LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_subnet'; END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE public.profiles
         SET gems = greatest(0, gems - r.gems_awarded)
       WHERE id = r.inviter_id;
      DELETE FROM public.referral_earnings WHERE id = r.id;
      UPDATE public.profiles
         SET referred_by = NULL, referral_locked_at = NULL
       WHERE id = r.invitee_id AND referred_by = r.inviter_id;
      INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
      VALUES (r.inviter_id, r.invitee_id, v_reason, v_matched)
      ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    END IF;
  END LOOP;
END$$;
