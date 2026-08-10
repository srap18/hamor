CREATE OR REPLACE FUNCTION public.golden_fisher_active_until(_user uuid)
RETURNS timestamp with time zone
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    CASE
      WHEN public.elite_vip6_active(_user) THEN
        COALESCE((SELECT p.elite_vip_expires_at FROM public.profiles p WHERE p.id = _user), 'infinity'::timestamptz)
      ELSE '-infinity'::timestamptz
    END,
    COALESCE((SELECT p.golden_fisher_until FROM public.profiles p WHERE p.id = _user), '-infinity'::timestamptz),
    COALESCE((
      SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
      FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at'
    ), '-infinity'::timestamptz)
  );
$$;

GRANT EXECUTE ON FUNCTION public.golden_fisher_active_until(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.award_vip_cashback(_uid uuid, _gold_spent bigint, _source text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _lvl int; _pct int; _amt bigint;
BEGIN
  IF _uid IS NULL OR _gold_spent IS NULL OR _gold_spent <= 0 THEN RETURN 0; END IF;
  _lvl := public.get_elite_vip_level(_uid);
  IF COALESCE(_lvl, 0) < 1 THEN RETURN 0; END IF;
  SELECT COALESCE(cashback_pct, 0) INTO _pct FROM public.elite_vip_tier_config WHERE level = _lvl;
  IF COALESCE(_pct, 0) <= 0 THEN RETURN 0; END IF;
  _amt := FLOOR(_gold_spent::numeric * _pct / 100.0)::bigint;
  IF _amt <= 0 THEN RETURN 0; END IF;
  PERFORM public._mutate_currency(_uid, _amt, 0, 0, 0);
  RETURN _amt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_vip_cashback(uuid, bigint, text) TO authenticated, service_role;

DO $fix$
DECLARE
  fn_oid oid;
  fn_def text;
BEGIN
  SELECT p.oid INTO fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_redeem_code_for'
    AND pg_get_function_identity_arguments(p.oid) = 'p_code text, p_target_user uuid';

  IF fn_oid IS NOT NULL THEN
    fn_def := pg_get_functiondef(fn_oid);
    fn_def := replace(fn_def, 'v_new_elite := least(5, greatest(', 'v_new_elite := least(6, greatest(');
    EXECUTE fn_def;
  END IF;
END;
$fix$;