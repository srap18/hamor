DO $$
DECLARE v_user uuid := '456112a7-0530-4098-bdab-b28418570115'; t0 timestamptz; r boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  t0 := clock_timestamp(); r := public.is_admin(v_user);
  INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (extract(epoch from (clock_timestamp()-t0))*1000, r, 'is_admin');
  t0 := clock_timestamp(); r := public.is_muted(v_user);
  INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (extract(epoch from (clock_timestamp()-t0))*1000, r, 'is_muted');
  t0 := clock_timestamp(); PERFORM count(*) FROM public.device_peer_candidates(v_user);
  INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (extract(epoch from (clock_timestamp()-t0))*1000, true, 'peers');
  PERFORM set_config('request.jwt.claims','',true);
END $$;