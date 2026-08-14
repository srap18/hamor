CREATE OR REPLACE FUNCTION public._trg_vip_coin_cashback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _spent bigint;
  _src text;
  _name text;
  -- purchase sources eligible for gold cashback.
  -- market/fish-market upgrades are intentionally EXCLUDED: they already get
  -- cashback explicitly inside the finalize_* functions (avoids double pay).
  _ok text[] := ARRAY[
    'buy_with_coins',
    'buy_with_coins_gem_fallback',
    '_pay_coins_with_gem_fallback',
    'buy_ship_by_code',
    'buy_catalog_item',
    'buy_lootbox',
    'buy_anti_to_inventory',
    'buy_shield_to_inventory',
    'buy_protection',
    'buy_dragon_equipment',
    'upgrade_dragon_item',
    'rent_market_capacity',
    'repair_ship_instant',
    'skip_shield_type_cooldown',
    'upgrade_submarine',
    'upgrade_royal_whale'
  ];
BEGIN
  IF COALESCE(current_setting('app.vip_coin_cashback', true), '0') = '1' THEN
    RETURN NEW;
  END IF;

  _spent := COALESCE(OLD.coins, 0) - COALESCE(NEW.coins, 0);
  IF _spent <= 0 THEN RETURN NEW; END IF;

  BEGIN
    _src := COALESCE(public._audit_current_source(), public._audit_caller_source());
  EXCEPTION WHEN OTHERS THEN
    _src := NULL;
  END;
  IF _src IS NULL THEN RETURN NEW; END IF;

  _name := regexp_replace(_src, '^(fn|rpc|direct):', '');
  IF NOT (_name = ANY(_ok)) THEN RETURN NEW; END IF;

  BEGIN
    PERFORM set_config('app.vip_coin_cashback', '1', true);
    PERFORM public.award_vip_cashback(NEW.id, _spent, _name);
    PERFORM set_config('app.vip_coin_cashback', '0', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.vip_coin_cashback', '0', true);
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vip_coin_cashback ON public.profiles;
CREATE TRIGGER trg_vip_coin_cashback
AFTER UPDATE OF coins ON public.profiles
FOR EACH ROW
WHEN (NEW.coins < OLD.coins)
EXECUTE FUNCTION public._trg_vip_coin_cashback();

REVOKE ALL ON FUNCTION public._trg_vip_coin_cashback() FROM PUBLIC, anon, authenticated;