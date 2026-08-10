DO $verify$
DECLARE
  uid uuid := 'd245f49e-1cd6-4eb3-a06e-cd063d9fd2f2'::uuid;
  cfg record;
BEGIN
  IF public.get_elite_vip_level(uid) <> 6 THEN RAISE EXCEPTION 'level failed'; END IF;
  IF public.user_market_capacity(uid) < public.fish_market_capacity(30) + 50000000 THEN RAISE EXCEPTION 'capacity failed'; END IF;
  IF public.golden_fisher_active_until(uid) <= now() THEN RAISE EXCEPTION 'golden fisher failed'; END IF;
  IF public.get_combat_multiplier(uid) <> 1.4 THEN RAISE EXCEPTION 'combat failed'; END IF;
  IF public.get_effective_shop_price(uid, 1000) <> 650 THEN RAISE EXCEPTION 'discount failed'; END IF;
  SELECT * INTO cfg FROM public.elite_vip_tier_config WHERE level=6;
  IF cfg.daily_gems<>1500 OR cfg.cashback_pct<>35 THEN RAISE EXCEPTION 'config failed'; END IF;
END;
$verify$;