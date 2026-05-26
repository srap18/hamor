
-- Track Stripe purchases for idempotency and weekly shield limit
CREATE TABLE public.stripe_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_session_id text NOT NULL UNIQUE,
  pack_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | paid | failed
  amount_cents integer NOT NULL DEFAULT 0,
  granted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  granted_at timestamptz
);

ALTER TABLE public.stripe_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_purchases" ON public.stripe_purchases
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "admin_view_all_purchases" ON public.stripe_purchases
  FOR SELECT USING (is_admin(auth.uid()));

CREATE INDEX idx_stripe_purchases_user_created ON public.stripe_purchases(user_id, created_at DESC);
CREATE INDEX idx_stripe_purchases_pack_user ON public.stripe_purchases(pack_id, user_id, created_at DESC);

-- Helper: count of shield purchases by this user in the last 7 days
CREATE OR REPLACE FUNCTION public.shield_purchases_last_week(_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::int, 0)
  FROM public.stripe_purchases
  WHERE user_id = _user
    AND pack_id LIKE 'shield_%'
    AND status = 'paid'
    AND created_at > now() - interval '7 days';
$$;

-- Has the user ever bought the one-time starter pack?
CREATE OR REPLACE FUNCTION public.has_bought_starter(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.stripe_purchases
    WHERE user_id = _user AND pack_id = 'bd_starter' AND status = 'paid'
  );
$$;

-- Apply rewards atomically + idempotent. Called from server fn after Stripe verifies payment.
CREATE OR REPLACE FUNCTION public.grant_stripe_purchase(
  _session_id text,
  _user uuid,
  _pack_id text,
  _amount_cents integer,
  _gems integer,
  _coins bigint,
  _rubies integer,
  _shield_days integer,
  _vip_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
BEGIN
  -- Idempotent: if already granted, return current state
  SELECT * INTO v_existing FROM public.stripe_purchases WHERE stripe_session_id = _session_id;
  IF FOUND AND v_existing.granted THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'pack_id', v_existing.pack_id);
  END IF;

  -- Insert / upsert the purchase row
  INSERT INTO public.stripe_purchases (user_id, stripe_session_id, pack_id, status, amount_cents, granted, granted_at)
  VALUES (_user, _session_id, _pack_id, 'paid', _amount_cents, true, now())
  ON CONFLICT (stripe_session_id) DO UPDATE
    SET status = 'paid', granted = true, granted_at = now();

  -- Apply currency rewards
  IF COALESCE(_gems,0) > 0 OR COALESCE(_coins,0) > 0 OR COALESCE(_rubies,0) > 0 THEN
    UPDATE public.profiles
    SET gems = gems + COALESCE(_gems,0),
        coins = coins + COALESCE(_coins,0),
        rubies = rubies + COALESCE(_rubies,0)
    WHERE id = _user;
  END IF;

  -- Apply shield (extend protection_until)
  IF COALESCE(_shield_days,0) > 0 THEN
    UPDATE public.profiles
    SET protection_until = GREATEST(COALESCE(protection_until, now()), now()) + (_shield_days || ' days')::interval
    WHERE id = _user;
  END IF;

  -- Apply VIP (also acts as protection)
  IF COALESCE(_vip_days,0) > 0 THEN
    UPDATE public.profiles
    SET protection_until = GREATEST(COALESCE(protection_until, now()), now()) + (_vip_days || ' days')::interval
    WHERE id = _user;
  END IF;

  -- Log a transaction row for history
  INSERT INTO public.transactions (user_id, kind, currency, amount, meta)
  VALUES (_user, 'stripe_purchase', 'usd', _amount_cents, jsonb_build_object(
    'pack_id', _pack_id,
    'session_id', _session_id,
    'gems', _gems, 'coins', _coins, 'rubies', _rubies,
    'shield_days', _shield_days, 'vip_days', _vip_days
  ));

  RETURN jsonb_build_object('ok', true, 'already_granted', false, 'pack_id', _pack_id);
END;
$$;
