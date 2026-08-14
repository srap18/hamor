DO $$
DECLARE r record; _total bigint := 0; _n int := 0;
BEGIN
  PERFORM set_config('app.audit_source', 'admin:vip_coin_cashback_backfill', true);
  PERFORM set_config('app.vip_coin_cashback', '1', true);
  FOR r IN
    with vip as (
      select p.id, p.elite_vip_level lvl, c.cashback_pct pct,
             greatest(now()-interval '30 days', p.elite_vip_expires_at - interval '30 days') as win_start
      from public.profiles p
      join public.elite_vip_tier_config c on c.level = p.elite_vip_level
      where coalesce(p.elite_vip_level,0) >= 1
        and p.elite_vip_expires_at is not null and p.elite_vip_expires_at > now()
        and not exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'admin')
    )
    select v.id, floor(sum(-e.coins_delta) * v.pct / 100.0)::bigint owed
    from vip v
    join public.economy_audit e on e.user_id = v.id
    where e.changed_at >= v.win_start and e.coins_delta < 0
      and regexp_replace(coalesce(e.source,''), '^(fn|rpc|direct):', '') in (
        'buy_with_coins','buy_with_coins_gem_fallback','_pay_coins_with_gem_fallback',
        'buy_ship_by_code','buy_catalog_item','buy_lootbox','buy_anti_to_inventory',
        'buy_shield_to_inventory','buy_protection','buy_dragon_equipment','upgrade_dragon_item',
        'rent_market_capacity','repair_ship_instant','skip_shield_type_cooldown',
        'upgrade_submarine','upgrade_royal_whale')
    group by v.id, v.pct
    having floor(sum(-e.coins_delta) * v.pct / 100.0)::bigint > 0
  LOOP
    UPDATE public.profiles SET coins = coins + r.owed WHERE id = r.id;
    _total := _total + r.owed; _n := _n + 1;
  END LOOP;
  PERFORM set_config('app.vip_coin_cashback', '0', true);
  RAISE NOTICE 'compensated % users, total % coins', _n, _total;
END $$;