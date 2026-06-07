
-- Referral system: code per user, link inviter on signup, reward inviter on purchases.

-- 1. Columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles(referred_by);

-- 2. Generate a unique 8-char referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
  exists_already boolean;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE referral_code = code) INTO exists_already;
    EXIT WHEN NOT exists_already;
  END LOOP;
  RETURN code;
END;
$$;

-- 3. Backfill existing users with a code
UPDATE public.profiles SET referral_code = public.generate_referral_code() WHERE referral_code IS NULL;

-- 4. Trigger: on new profile insert, assign code if missing
CREATE OR REPLACE FUNCTION public.set_referral_code_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_referral_code ON public.profiles;
CREATE TRIGGER trg_profiles_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_referral_code_on_insert();

-- 5. Apply a referral code for the current authenticated user (one-time, immutable)
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_inviter uuid;
  v_current uuid;
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

  SELECT id INTO v_inviter FROM public.profiles WHERE upper(referral_code) = upper(trim(p_code)) LIMIT 1;
  IF v_inviter IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found');
  END IF;
  IF v_inviter = v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  UPDATE public.profiles
    SET referred_by = v_inviter, referral_locked_at = now()
    WHERE id = v_me AND referred_by IS NULL;

  RETURN jsonb_build_object('ok', true, 'inviter', v_inviter);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_referral_code(text) TO authenticated;

-- 6. Earnings ledger
CREATE TABLE IF NOT EXISTS public.referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL,
  invitee_id uuid NOT NULL,
  txn_id text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  gems_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (txn_id, inviter_id)
);

GRANT SELECT ON public.referral_earnings TO authenticated;
GRANT ALL ON public.referral_earnings TO service_role;
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY re_select_own ON public.referral_earnings
  FOR SELECT TO authenticated
  USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);

-- 7. Grant referral bonus (called from paddle webhook). Reward: $1 = 100 gems base × 30% = amount_cents * 0.30 gems.
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
BEGIN
  IF _user IS NULL OR _amount_cents <= 0 THEN RETURN; END IF;

  SELECT referred_by INTO v_inviter FROM public.profiles WHERE id = _user;
  IF v_inviter IS NULL THEN RETURN; END IF;

  v_bonus := floor(_amount_cents::numeric * 0.30)::int;
  IF v_bonus <= 0 THEN RETURN; END IF;

  -- Idempotent: skip if already recorded for this txn+inviter
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
