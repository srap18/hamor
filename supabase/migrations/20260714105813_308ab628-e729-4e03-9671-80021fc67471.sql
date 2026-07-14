
-- 1) Per-user finalize (fast path, only touches one row).
CREATE OR REPLACE FUNCTION public.finalize_market_upgrade_for(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  SELECT user_id, upgrade_cost_coins, upgrading_to
    INTO r
    FROM public.user_market
    WHERE user_id = _uid
      AND upgrade_ends_at IS NOT NULL
      AND upgrade_ends_at <= now() + interval '10 seconds'
      AND upgrading_to IS NOT NULL
    FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.user_market
     SET level = GREATEST(level, r.upgrading_to),
         upgrading_to = NULL,
         upgrade_started_at = NULL,
         upgrade_ends_at = NULL,
         upgrade_cost_coins = NULL,
         updated_at = now()
   WHERE user_id = r.user_id;

  IF COALESCE(r.upgrade_cost_coins, 0) > 0 THEN
    PERFORM public.award_vip_cashback(r.user_id, r.upgrade_cost_coins, 'market_upgrade');
  END IF;
END;
$$;

-- 2) Replace hot-path prep to avoid global sweep.
CREATE OR REPLACE FUNCTION public._prep_pvp_checks(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  PERFORM public.finalize_market_upgrade_for(_uid);
  INSERT INTO public.user_market(user_id, level)
  VALUES (_uid, 1)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- 3) Helpful indexes.
CREATE INDEX IF NOT EXISTS idx_attacks_defender_created
  ON public.attacks (defender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ships_owned_user_at_sea
  ON public.ships_owned (user_id)
  WHERE at_sea = true AND destroyed_at IS NULL;
