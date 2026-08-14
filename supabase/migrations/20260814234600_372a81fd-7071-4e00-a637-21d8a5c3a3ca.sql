DO $$
DECLARE
  _vip uuid := 'd245f49e-1cd6-4eb3-a06e-cd063d9fd2f2';  -- VIP6 (35%)
  _c0 bigint; _c1 bigint; _c2 bigint;
  _plain uuid; _p0 bigint; _p1 bigint;
BEGIN
  -- 1) eligible purchase source -> expect 35% back
  SELECT coins INTO _c0 FROM public.profiles WHERE id = _vip;
  PERFORM set_config('app.audit_source', 'fn:buy_with_coins', true);
  UPDATE public.profiles SET coins = coins - 1000000 WHERE id = _vip;
  SELECT coins INTO _c1 FROM public.profiles WHERE id = _vip;
  RAISE NOTICE 'VIP6 buy_with_coins: before=% after=% net=% (expect -650000)', _c0, _c1, _c1 - _c0;

  -- 2) excluded source (gift transfer) -> expect no cashback
  PERFORM set_config('app.audit_source', 'fn:gift_gold', true);
  UPDATE public.profiles SET coins = coins - 1000000 WHERE id = _vip;
  SELECT coins INTO _c2 FROM public.profiles WHERE id = _vip;
  RAISE NOTICE 'VIP6 gift_gold: net=% (expect -1000000)', _c2 - _c1;

  -- 3) non-VIP -> expect no cashback
  SELECT id, coins INTO _plain, _p0 FROM public.profiles
   WHERE COALESCE(elite_vip_level,0) = 0 AND coins > 5000000 LIMIT 1;
  PERFORM set_config('app.audit_source', 'fn:buy_with_coins', true);
  UPDATE public.profiles SET coins = coins - 1000000 WHERE id = _plain;
  SELECT coins INTO _p1 FROM public.profiles WHERE id = _plain;
  RAISE NOTICE 'non-VIP buy_with_coins: net=% (expect -1000000)', _p1 - _p0;

  -- restore exact balances
  PERFORM set_config('app.vip_coin_cashback', '1', true);
  PERFORM set_config('app.audit_source', 'admin:cashback_test_restore', true);
  UPDATE public.profiles SET coins = _c0 WHERE id = _vip;
  UPDATE public.profiles SET coins = _p0 WHERE id = _plain;
  PERFORM set_config('app.vip_coin_cashback', '0', true);
END $$;