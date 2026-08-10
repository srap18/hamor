DO $verify$
DECLARE
  fn record;
  normal_ok boolean := false;
  admin_ok boolean := false;
  sync_ok boolean := false;
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('redeem_code','admin_redeem_code_for','resync_my_elite_vip')
  LOOP
    IF fn.proname = 'redeem_code' AND fn.def LIKE '%least(6, greatest%' THEN normal_ok := true; END IF;
    IF fn.proname = 'admin_redeem_code_for' AND fn.def LIKE '%least(6, greatest%' THEN admin_ok := true; END IF;
    IF fn.proname = 'resync_my_elite_vip' AND fn.def LIKE '%elite_vip_[1-6]_monthly%' THEN sync_ok := true; END IF;
  END LOOP;
  IF NOT normal_ok THEN RAISE EXCEPTION 'VIP6 normal code path is not active'; END IF;
  IF NOT admin_ok THEN RAISE EXCEPTION 'VIP6 admin code path is not active'; END IF;
  IF NOT sync_ok THEN RAISE EXCEPTION 'VIP6 resync path is not active'; END IF;
END;
$verify$;