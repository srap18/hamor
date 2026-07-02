
-- Add kind column to referral_earnings to distinguish reward types
ALTER TABLE public.referral_earnings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS note text;

CREATE INDEX IF NOT EXISTS idx_referral_earnings_inviter_created
  ON public.referral_earnings (inviter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_earnings_kind
  ON public.referral_earnings (kind);

-- Table to track rejected referrals (same IP/device) for admin visibility
CREATE TABLE IF NOT EXISTS public.referral_blocked_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL,
  invitee_id uuid NOT NULL,
  reason text NOT NULL,
  matched_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inviter_id, invitee_id)
);

GRANT SELECT ON public.referral_blocked_attempts TO authenticated;
GRANT ALL ON public.referral_blocked_attempts TO service_role;
ALTER TABLE public.referral_blocked_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rba_admin_read" ON public.referral_blocked_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Rewrite apply_referral_code to:
--  1) check IP overlap (user_ips) and device overlap (device_accounts)
--  2) award 500 gems instantly if clean
--  3) award 2000 gems bonus at 10 clean referrals
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
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

  -- Security check: shared IP
  SELECT a.ip INTO v_shared_ip
    FROM public.user_ips a
    JOIN public.user_ips b ON a.ip = b.ip
   WHERE a.user_id = v_inviter AND b.user_id = v_me
   LIMIT 1;

  IF v_shared_ip IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'same_ip', v_shared_ip)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'same_ip');
  END IF;

  -- Security check: shared device
  SELECT a.device_id INTO v_shared_device
    FROM public.device_accounts a
    JOIN public.device_accounts b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me
   LIMIT 1;

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

  -- Check milestone: count clean (signup) rewards for this inviter
  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings
   WHERE inviter_id = v_inviter AND kind = 'signup';

  IF v_clean_count >= v_milestone_target THEN
    -- Award milestone bonus once
    INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
    VALUES (v_inviter, v_me, 'milestone:10:' || v_inviter::text, 0, v_milestone_gems, 'milestone', 'مكافأة إنجاز 10 دعوات ناجحة')
    ON CONFLICT (txn_id, inviter_id) DO NOTHING;

    -- Only add gems if this actually inserted (i.e. first time reaching 10)
    IF FOUND THEN
      UPDATE public.profiles
         SET gems = gems + v_milestone_gems
       WHERE id = v_inviter;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'inviter', v_inviter, 'signup_gems', v_signup_gems);
END;
$function$;

-- Weekly leaderboard (top inviters this ISO week by clean signups)
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard_weekly(p_limit int DEFAULT 10)
RETURNS TABLE (
  inviter_id uuid,
  display_name text,
  username text,
  avatar_url text,
  avatar_emoji text,
  avatar_frame text,
  invites_count bigint,
  gems_earned bigint,
  rank int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH agg AS (
    SELECT e.inviter_id,
           count(*) FILTER (WHERE e.kind = 'signup') AS invites_count,
           coalesce(sum(e.gems_awarded), 0)::bigint AS gems_earned
      FROM public.referral_earnings e
     WHERE e.created_at >= date_trunc('week', now())
     GROUP BY e.inviter_id
  )
  SELECT p.id, p.display_name, p.username, p.avatar_url, p.avatar_emoji, p.avatar_frame,
         a.invites_count, a.gems_earned,
         (row_number() OVER (ORDER BY a.invites_count DESC, a.gems_earned DESC))::int AS rank
    FROM agg a
    JOIN public.profiles p ON p.id = a.inviter_id
   WHERE a.invites_count > 0
   ORDER BY a.invites_count DESC, a.gems_earned DESC
   LIMIT greatest(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard_weekly(int) TO authenticated, anon;

-- All-time leaderboard
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard_alltime(p_limit int DEFAULT 50)
RETURNS TABLE (
  inviter_id uuid,
  display_name text,
  username text,
  avatar_url text,
  avatar_emoji text,
  avatar_frame text,
  invites_count bigint,
  gems_earned bigint,
  rank int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH agg AS (
    SELECT e.inviter_id,
           count(*) FILTER (WHERE e.kind = 'signup') AS invites_count,
           coalesce(sum(e.gems_awarded), 0)::bigint AS gems_earned
      FROM public.referral_earnings e
     GROUP BY e.inviter_id
  )
  SELECT p.id, p.display_name, p.username, p.avatar_url, p.avatar_emoji, p.avatar_frame,
         a.invites_count, a.gems_earned,
         (row_number() OVER (ORDER BY a.invites_count DESC, a.gems_earned DESC))::int AS rank
    FROM agg a
    JOIN public.profiles p ON p.id = a.inviter_id
   WHERE a.invites_count > 0
   ORDER BY a.invites_count DESC, a.gems_earned DESC
   LIMIT greatest(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard_alltime(int) TO authenticated, anon;

-- Admin: full list of inviters with counts + blocked attempts
CREATE OR REPLACE FUNCTION public.admin_get_referrals_overview(p_limit int DEFAULT 200)
RETURNS TABLE (
  inviter_id uuid,
  display_name text,
  username text,
  avatar_url text,
  avatar_emoji text,
  clean_invites bigint,
  blocked_invites bigint,
  gems_earned bigint,
  last_invite_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH clean AS (
    SELECT inviter_id,
           count(*) FILTER (WHERE kind='signup') AS clean_invites,
           coalesce(sum(gems_awarded),0)::bigint AS gems_earned,
           max(created_at) AS last_invite_at
      FROM public.referral_earnings
     GROUP BY inviter_id
  ),
  blocked AS (
    SELECT inviter_id, count(*)::bigint AS blocked_invites
      FROM public.referral_blocked_attempts
     GROUP BY inviter_id
  ),
  all_ids AS (
    SELECT inviter_id FROM clean
    UNION
    SELECT inviter_id FROM blocked
  )
  SELECT p.id, p.display_name, p.username, p.avatar_url, p.avatar_emoji,
         coalesce(c.clean_invites, 0),
         coalesce(b.blocked_invites, 0),
         coalesce(c.gems_earned, 0),
         c.last_invite_at
    FROM all_ids a
    JOIN public.profiles p ON p.id = a.inviter_id
    LEFT JOIN clean c ON c.inviter_id = a.inviter_id
    LEFT JOIN blocked b ON b.inviter_id = a.inviter_id
   WHERE public.is_admin(auth.uid())
   ORDER BY coalesce(c.clean_invites, 0) DESC, coalesce(c.gems_earned, 0) DESC
   LIMIT greatest(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_referrals_overview(int) TO authenticated;

-- Admin: manual grant of gems to any user (for contests/rewards)
CREATE OR REPLACE FUNCTION public.admin_grant_referral_gift(
  p_user_id uuid,
  p_gems int,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_txn_id text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  IF p_user_id IS NULL OR p_gems IS NULL OR p_gems <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  v_txn_id := 'admin_grant:' || gen_random_uuid()::text;

  INSERT INTO public.referral_earnings
    (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
  VALUES
    (p_user_id, p_user_id, v_txn_id, 0, p_gems, 'admin_grant',
     coalesce(p_note, 'منحة من الإدارة'));

  UPDATE public.profiles SET gems = gems + p_gems WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'gems', p_gems);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_grant_referral_gift(uuid, int, text) TO authenticated;

-- User: get own referral stats (invites count + milestone progress)
CREATE OR REPLACE FUNCTION public.get_my_referral_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'clean_invites', coalesce((SELECT count(*) FROM public.referral_earnings
                                WHERE inviter_id = auth.uid() AND kind = 'signup'), 0),
    'total_gems',    coalesce((SELECT sum(gems_awarded) FROM public.referral_earnings
                                WHERE inviter_id = auth.uid()), 0),
    'weekly_invites',coalesce((SELECT count(*) FROM public.referral_earnings
                                WHERE inviter_id = auth.uid() AND kind = 'signup'
                                  AND created_at >= date_trunc('week', now())), 0),
    'milestone_target', 10,
    'signup_reward', 500,
    'milestone_reward', 2000
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_my_referral_stats() TO authenticated;
