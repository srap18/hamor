-- ============= Redemption codes system =============
-- Admin creates one-time-use codes that grant either a specific item/ship
-- from the catalog OR a currency bundle (coins / gems / xp). Each code
-- can be redeemed once per user, up to max_uses total redemptions.

CREATE TABLE public.redemption_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  -- 'item' = items_catalog row (item_id stores items_catalog.code, item_kind stores items_catalog.kind)
  -- 'ship' = ship_catalog row (item_id stores ship_catalog.code)
  -- 'bundle' = currency bundle (uses reward_coins/reward_gems/reward_xp)
  reward_type TEXT NOT NULL CHECK (reward_type IN ('item','ship','bundle')),
  item_id TEXT,
  item_kind TEXT,
  reward_coins BIGINT NOT NULL DEFAULT 0,
  reward_gems INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redemption_codes_code ON public.redemption_codes(code);

GRANT SELECT ON public.redemption_codes TO authenticated;
GRANT ALL ON public.redemption_codes TO service_role;

ALTER TABLE public.redemption_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY rc_admin_manage ON public.redemption_codes
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Anyone authenticated may read a code row only to validate it during redemption.
-- (The redeem function below also enforces validity.)
CREATE POLICY rc_authenticated_view ON public.redemption_codes
  FOR SELECT TO authenticated
  USING (true);

-- ============= Redemptions log =============
CREATE TABLE public.code_redemptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code_id UUID NOT NULL REFERENCES public.redemption_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code_id, user_id)
);

CREATE INDEX idx_code_redemptions_user ON public.code_redemptions(user_id);

GRANT SELECT ON public.code_redemptions TO authenticated;
GRANT ALL ON public.code_redemptions TO service_role;

ALTER TABLE public.code_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cr_user_view_own ON public.code_redemptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_admin(auth.uid()));

-- ============= Redeem function =============
-- Atomically validates a code, applies the reward, logs the redemption.
-- SECURITY DEFINER so it can write profile/inventory/log rows under RLS.
CREATE OR REPLACE FUNCTION public.redeem_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  public.redemption_codes%ROWTYPE;
  v_template_id INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.redemption_codes
  WHERE code = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  IF NOT v_row.active THEN
    RAISE EXCEPTION 'code_disabled';
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RAISE EXCEPTION 'code_expired';
  END IF;

  IF v_row.uses_count >= v_row.max_uses THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.code_redemptions
    WHERE code_id = v_row.id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  -- Apply reward by type
  IF v_row.reward_type = 'bundle' THEN
    UPDATE public.profiles
       SET coins = coins + v_row.reward_coins,
           gems  = gems  + v_row.reward_gems,
           xp    = xp    + v_row.reward_xp
     WHERE id = v_user;

  ELSIF v_row.reward_type = 'item' THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, COALESCE(v_row.item_kind, 'misc'), v_row.item_id, GREATEST(v_row.quantity, 1));

  ELSIF v_row.reward_type = 'ship' THEN
    -- Find the template_id for this ship catalog code if available
    SELECT sort_order INTO v_template_id
      FROM public.ship_catalog
     WHERE code = v_row.item_id
     LIMIT 1;

    INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
    SELECT v_user, COALESCE(v_template_id, 1), v_row.item_id, max_hp, max_hp
      FROM public.ship_catalog
     WHERE code = v_row.item_id
     LIMIT 1;
  END IF;

  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_row.id, v_user);

  UPDATE public.redemption_codes
     SET uses_count = uses_count + 1
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'reward_type', v_row.reward_type,
    'item_id', v_row.item_id,
    'reward_coins', v_row.reward_coins,
    'reward_gems', v_row.reward_gems,
    'reward_xp', v_row.reward_xp,
    'quantity', v_row.quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_code(TEXT) TO authenticated;