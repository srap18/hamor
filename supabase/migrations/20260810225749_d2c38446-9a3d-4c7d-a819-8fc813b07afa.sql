DO $$
DECLARE d text; r record;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('redeem_code','admin_redeem_code_for')
  LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'least(5, greatest(COALESCE(v_cur_elite', 'least(6, greatest(COALESCE(v_cur_elite');
    EXECUTE d;
  END LOOP;
END $$;