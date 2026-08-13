CREATE OR REPLACE FUNCTION public._audit_caller_source()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _ctx text;
  _n text;
  _skip text[] := ARRAY[
    '_trg_profiles_economy_audit','_audit_caller_source','_mutate_currency',
    '_protect_profile_currency','_pay_coins_with_gem_fallback','add_vip_points',
    '_audit_current_source','_audit_current_reason'
  ];
BEGIN
  GET DIAGNOSTICS _ctx = PG_CONTEXT;
  FOR _n IN
    SELECT m[1] FROM regexp_matches(COALESCE(_ctx,''), 'function ([a-zA-Z0-9_]+)\(', 'g') AS m
  LOOP
    IF NOT (_n = ANY(_skip)) THEN
      RETURN 'fn:' || _n;
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public._trg_profiles_economy_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c_delta bigint := COALESCE(NEW.coins,0) - COALESCE(OLD.coins,0);
  _g_delta bigint := COALESCE(NEW.gems, 0) - COALESCE(OLD.gems, 0);
  _src text;
BEGIN
  IF _c_delta = 0 AND _g_delta = 0 THEN RETURN NEW; END IF;
  _src := public._audit_current_source();
  IF _src IS NULL THEN
    _src := public._audit_caller_source();
  END IF;
  INSERT INTO public.economy_audit(
    user_id, coins_delta, gems_delta,
    coins_before, coins_after, gems_before, gems_after,
    source, reason
  ) VALUES (
    NEW.id, _c_delta, _g_delta,
    OLD.coins, NEW.coins, OLD.gems, NEW.gems,
    _src,
    public._audit_current_reason()
  );
  RETURN NEW;
END
$$;