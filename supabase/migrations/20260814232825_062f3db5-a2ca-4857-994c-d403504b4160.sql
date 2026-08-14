-- Gem cashback for Elite VIP members on any gem spend.
CREATE OR REPLACE FUNCTION public.award_vip_cashback_gems(_uid uuid, _gems_spent bigint, _source text DEFAULT NULL::text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _lvl int; _pct int; _amt bigint;
BEGIN
  IF _uid IS NULL OR _gems_spent IS NULL OR _gems_spent <= 0 THEN RETURN 0; END IF;
  _lvl := public.get_elite_vip_level(_uid);
  IF COALESCE(_lvl, 0) < 1 THEN RETURN 0; END IF;
  SELECT COALESCE(cashback_pct, 0) INTO _pct FROM public.elite_vip_tier_config WHERE level = _lvl;
  IF COALESCE(_pct, 0) <= 0 THEN RETURN 0; END IF;
  _amt := FLOOR(_gems_spent::numeric * _pct / 100.0)::bigint;
  IF _amt <= 0 THEN RETURN 0; END IF;

  PERFORM set_config('app.vip_gem_cashback', '1', true);
  BEGIN
    UPDATE public.profiles SET gems = gems + _amt::int WHERE id = _uid;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.vip_gem_cashback', '0', true);
    RAISE;
  END;
  PERFORM set_config('app.vip_gem_cashback', '0', true);
  RETURN _amt;
END;
$function$;

REVOKE ALL ON FUNCTION public.award_vip_cashback_gems(uuid, bigint, text) FROM PUBLIC, anon, authenticated;

-- Central hook: any negative gem delta on a profile grants VIP gem cashback.
CREATE OR REPLACE FUNCTION public._trg_vip_gem_cashback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _spent bigint; _src text;
BEGIN
  -- Never recurse on the cashback payout itself.
  IF COALESCE(current_setting('app.vip_gem_cashback', true), '0') = '1' THEN
    RETURN NEW;
  END IF;

  _spent := COALESCE(OLD.gems, 0) - COALESCE(NEW.gems, 0);
  IF _spent <= 0 THEN RETURN NEW; END IF;

  -- Skip admin adjustments / direct profile writes — those are not purchases.
  BEGIN
    _src := COALESCE(public._audit_current_source(), public._audit_caller_source());
  EXCEPTION WHEN OTHERS THEN
    _src := NULL;
  END;
  IF _src IS NOT NULL AND (_src ILIKE '%admin%' OR _src = 'direct:profiles_update') THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.award_vip_cashback_gems(NEW.id, _spent, COALESCE(_src, 'gem_spend'));
  EXCEPTION WHEN OTHERS THEN
    -- Cashback must never break a purchase.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_vip_gem_cashback ON public.profiles;
CREATE TRIGGER trg_vip_gem_cashback
AFTER UPDATE OF gems ON public.profiles
FOR EACH ROW
WHEN (NEW.gems < OLD.gems)
EXECUTE FUNCTION public._trg_vip_gem_cashback();