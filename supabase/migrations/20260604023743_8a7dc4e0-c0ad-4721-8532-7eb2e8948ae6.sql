CREATE OR REPLACE FUNCTION public.admin_redeem_code_for_all(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_ok int := 0;
  v_skip int := 0;
  v_total int := 0;
  v_user record;
  v_err text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- admin check: prefer has_role('admin'), fallback to user_roles direct read
  BEGIN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  EXCEPTION WHEN others THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller AND role = 'admin'::app_role)
      INTO v_is_admin;
  END;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  FOR v_user IN SELECT id FROM auth.users WHERE deleted_at IS NULL LOOP
    v_total := v_total + 1;
    BEGIN
      PERFORM public.admin_redeem_code_for(p_code, v_user.id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE '%already_redeemed%' THEN
        v_skip := v_skip + 1;
      ELSIF v_err ~ '(invalid_code|code_expired|code_disabled|admin_only)' THEN
        RAISE EXCEPTION '%', v_err;
      ELSE
        v_skip := v_skip + 1;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok_count', v_ok, 'skipped', v_skip, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_redeem_code_for_all(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_redeem_code_for_all(text) TO authenticated;