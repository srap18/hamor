
CREATE OR REPLACE FUNCTION public.award_pending_referral_if_qualified(_invitee uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inviter uuid;
  v_level int;
  v_clean_count int;
  v_signup_gems constant int := 500;
  v_milestone_gems constant int := 2000;
  v_milestone_target constant int := 10;
  v_awarded boolean := false;
BEGIN
  IF _invitee IS NULL THEN RETURN false; END IF;
  SELECT referred_by INTO v_inviter FROM public.profiles WHERE id = _invitee;
  IF v_inviter IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.referral_earnings
              WHERE inviter_id = v_inviter AND invitee_id = _invitee AND kind = 'signup') THEN
    RETURN false;
  END IF;
  SELECT COALESCE(level, 1) INTO v_level FROM public.user_market WHERE user_id = _invitee;
  v_level := COALESCE(v_level, 1);
  IF v_level < 6 THEN RETURN false; END IF;

  INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
  VALUES (v_inviter, _invitee, 'signup:' || _invitee::text, 0, v_signup_gems, 'signup', 'مكافأة دعوة صديق (وصل مستوى سوق السفن 6)')
  ON CONFLICT (txn_id, inviter_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.profiles SET gems = gems + v_signup_gems WHERE id = v_inviter;
    v_awarded := true;
  END IF;

  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings WHERE inviter_id = v_inviter AND kind = 'signup';
  IF v_clean_count >= v_milestone_target THEN
    INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
    VALUES (v_inviter, _invitee, 'milestone:10:' || v_inviter::text, 0, v_milestone_gems, 'milestone', 'مكافأة إنجاز 10 دعوات ناجحة')
    ON CONFLICT (txn_id, inviter_id) DO NOTHING;
    IF FOUND THEN
      UPDATE public.profiles SET gems = gems + v_milestone_gems WHERE id = v_inviter;
    END IF;
  END IF;
  RETURN v_awarded;
END;
$function$;

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

  -- Strict device-only anti-abuse
  SELECT a.device_id INTO v_matched
    FROM public.device_history a
    JOIN public.device_history b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me AND length(a.device_id) >= 32
   LIMIT 1;
  IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

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

  UPDATE public.profiles SET referred_by = v_inviter, referral_locked_at = now()
    WHERE id = v_me AND referred_by IS NULL;

  PERFORM public.award_pending_referral_if_qualified(v_me);

  RETURN jsonb_build_object('ok', true, 'inviter', v_inviter, 'pending', true, 'unlock_at_market_level', 6);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_award_referral_on_market_level()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.level, 1) >= 6
     AND COALESCE(NEW.level, 1) <> COALESCE(OLD.level, 0) THEN
    PERFORM public.award_pending_referral_if_qualified(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_award_referral_on_market_level ON public.user_market;
CREATE TRIGGER trg_award_referral_on_market_level
AFTER INSERT OR UPDATE OF level ON public.user_market
FOR EACH ROW EXECUTE FUNCTION public.trg_award_referral_on_market_level();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id AS invitee
      FROM public.profiles p
      JOIN public.user_market um ON um.user_id = p.id
     WHERE p.referred_by IS NOT NULL
       AND COALESCE(um.level,1) >= 6
       AND NOT EXISTS (
         SELECT 1 FROM public.referral_earnings e
          WHERE e.inviter_id = p.referred_by AND e.invitee_id = p.id AND e.kind='signup'
       )
  LOOP
    PERFORM public.award_pending_referral_if_qualified(r.invitee);
  END LOOP;
END $$;
