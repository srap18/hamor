DO $verify$
DECLARE
  uid uuid := 'd245f49e-1cd6-4eb3-a06e-cd063d9fd2f2'::uuid;
  lvl int;
  cap bigint;
  gf timestamptz;
  combat numeric;
  price numeric;
  cfg record;
BEGIN
  lvl := public.get_elite_vip_level(uid);
  IF lvl <> 6 THEN RAISE EXCEPTION 'vip6 verification failed: level=%', lvl; END IF;

  cap := public.user_market_capacity(uid);
  IF cap < public.fish_market_capacity(30) + 50000000 THEN
    RAISE EXCEPTION 'vip6 verification failed: capacity=%', cap;
  END IF;

  gf := public.golden_fisher_active_until(uid);
  IF gf <= now() THEN RAISE EXCEPTION 'vip6 verification failed: golden fisher inactive'; END IF;

  combat := public.get_combat_multiplier(uid);
  IF combat <> 1.4 THEN RAISE EXCEPTION 'vip6 verification failed: combat=%', combat; END IF;

  price := public.get_effective_shop_price(uid, 1000);
  IF price <> 650 THEN RAISE EXCEPTION 'vip6 verification failed: price=%', price; END IF;

  SELECT * INTO cfg FROM public.elite_vip_tier_config WHERE level = 6;
  IF cfg.daily_gems <> 1500 OR cfg.cashback_pct <> 35 OR cfg.combat_bonus_pct <> 40 OR cfg.shop_discount_pct <> 35 THEN
    RAISE EXCEPTION 'vip6 verification failed: tier config mismatch';
  END IF;

  IF NOT public.elite_vip6_active(uid) THEN RAISE EXCEPTION 'vip6 verification failed: inactive helper'; END IF;
END;
$verify$;