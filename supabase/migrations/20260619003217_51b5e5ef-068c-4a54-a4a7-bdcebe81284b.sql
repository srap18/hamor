
-- 1) polar_purchases table
CREATE TABLE public.polar_purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  polar_checkout_id TEXT NOT NULL UNIQUE,
  polar_order_id TEXT,
  pack_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  status TEXT NOT NULL DEFAULT 'pending',
  granted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_polar_purchases_user ON public.polar_purchases(user_id);
CREATE INDEX idx_polar_purchases_order ON public.polar_purchases(polar_order_id);

GRANT SELECT ON public.polar_purchases TO authenticated;
GRANT ALL ON public.polar_purchases TO service_role;

ALTER TABLE public.polar_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own polar purchases"
  ON public.polar_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) grant_polar_purchase RPC (idempotent on polar_checkout_id)
CREATE OR REPLACE FUNCTION public.grant_polar_purchase(
  _checkout_id TEXT,
  _order_id TEXT,
  _user UUID,
  _pack_id TEXT,
  _amount_cents INTEGER,
  _gems INTEGER DEFAULT 0,
  _coins INTEGER DEFAULT 0,
  _rubies INTEGER DEFAULT 0,
  _shield_days INTEGER DEFAULT 0,
  _vip_days INTEGER DEFAULT 0,
  _env TEXT DEFAULT 'sandbox'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing public.polar_purchases%ROWTYPE;
BEGIN
  -- Idempotency: if checkout already granted, no-op.
  SELECT * INTO _existing FROM public.polar_purchases WHERE polar_checkout_id = _checkout_id;
  IF FOUND AND _existing.status = 'granted' THEN
    RETURN FALSE;
  END IF;

  -- Insert or update the purchase record
  INSERT INTO public.polar_purchases (
    user_id, polar_checkout_id, polar_order_id, pack_id, amount_cents, environment, status, granted_at
  ) VALUES (
    _user, _checkout_id, _order_id, _pack_id, _amount_cents, _env, 'granted', now()
  )
  ON CONFLICT (polar_checkout_id) DO UPDATE
    SET status = 'granted',
        polar_order_id = COALESCE(EXCLUDED.polar_order_id, public.polar_purchases.polar_order_id),
        granted_at = now()
    WHERE public.polar_purchases.status <> 'granted';

  -- Grant currency rewards on profiles
  IF _gems > 0 OR _coins > 0 OR _rubies > 0 THEN
    UPDATE public.profiles
       SET gems = COALESCE(gems, 0) + _gems,
           coins = COALESCE(coins, 0) + _coins,
           rubies = COALESCE(rubies, 0) + _rubies
     WHERE id = _user;
  END IF;

  -- Shield days: add to shield_until
  IF _shield_days > 0 THEN
    UPDATE public.profiles
       SET shield_until = GREATEST(COALESCE(shield_until, now()), now()) + (_shield_days || ' days')::interval
     WHERE id = _user;
  END IF;

  -- VIP days: add to vip_until
  IF _vip_days > 0 THEN
    UPDATE public.profiles
       SET vip_until = GREATEST(COALESCE(vip_until, now()), now()) + (_vip_days || ' days')::interval
     WHERE id = _user;
  END IF;

  -- Transaction log
  INSERT INTO public.transaction_logs (user_id, kind, amount_cents, meta)
  VALUES (_user, 'polar_purchase', _amount_cents,
          jsonb_build_object('pack_id', _pack_id, 'checkout_id', _checkout_id, 'order_id', _order_id, 'env', _env));

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_polar_purchase(TEXT, TEXT, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;
