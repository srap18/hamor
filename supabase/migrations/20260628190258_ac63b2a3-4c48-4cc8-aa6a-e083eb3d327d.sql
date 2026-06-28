CREATE OR REPLACE FUNCTION public.finalize_market_upgrades()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_market
  SET level = GREATEST(level, upgrading_to),
      upgrading_to = NULL,
      upgrade_started_at = NULL,
      upgrade_ends_at = NULL,
      upgrade_cost_coins = NULL,
      updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL
    AND upgrade_ends_at <= now() + interval '10 seconds'
    AND upgrading_to IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.finalize_fish_market_upgrades()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_fish_market
  SET level = GREATEST(level, upgrading_to),
      upgrading_to = NULL,
      upgrade_started_at = NULL,
      upgrade_ends_at = NULL,
      upgrade_cost_coins = NULL,
      updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL
    AND upgrade_ends_at <= now() + interval '10 seconds'
    AND upgrading_to IS NOT NULL;
$$;

-- One-shot: flush anything currently past due.
SELECT public.finalize_market_upgrades();
SELECT public.finalize_fish_market_upgrades();