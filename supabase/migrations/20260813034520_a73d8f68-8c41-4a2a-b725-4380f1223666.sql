CREATE OR REPLACE FUNCTION public._audit_caller_source()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _ctx text;
  _q text;
  _n text;
  _skip text[] := ARRAY[
    '_trg_profiles_economy_audit','_audit_caller_source','_mutate_currency',
    '_protect_profile_currency','_pay_coins_with_gem_fallback','add_vip_points',
    '_audit_current_source','_audit_current_reason','_trg_fish_stock_audit'
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

  _q := current_query();
  FOR _n IN
    SELECT m[1] FROM regexp_matches(COALESCE(_q,''), '"public"\."([a-zA-Z0-9_]+)"\(', 'g') AS m
  LOOP
    IF NOT (_n = ANY(_skip)) THEN
      RETURN 'rpc:' || _n;
    END IF;
  END LOOP;

  IF _q ~* '^\s*(with\s+pgrst_|update\s+"?public"?\."?profiles)' THEN
    RETURN 'direct:profiles_update';
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;