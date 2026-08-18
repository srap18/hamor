CREATE TABLE IF NOT EXISTS public._redeem_test_log (id bigserial primary key, at timestamptz default now(), ms numeric, ok boolean, msg text);

DO $$
DECLARE
  v_user uuid := '456112a7-0530-4098-bdab-b28418570115';
  v_code text := 'ZZK' || floor(random()*100000)::text;
  v_id uuid;
  t0 timestamptz; v_ms numeric; v_res jsonb;
  v_extra jsonb := (SELECT extra_rewards FROM public.redemption_codes WHERE code = 'N6QCU9T2');
BEGIN
  CREATE TEMP TABLE inv_before ON COMMIT DROP AS
    SELECT id, quantity FROM public.inventory WHERE user_id = v_user;

  INSERT INTO public.redemption_codes (code, reward_type, reward_coins, reward_gems, reward_xp, quantity, max_uses, active, extra_rewards, note)
  VALUES (v_code, 'bundle', 0, 0, 0, 1, 1, true, v_extra, 'internal test')
  RETURNING id INTO v_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  t0 := clock_timestamp();
  BEGIN
    v_res := public.redeem_code(v_code);
    v_ms := extract(epoch from (clock_timestamp() - t0)) * 1000;
    INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (v_ms, true, left(v_res::text, 400));
  EXCEPTION WHEN OTHERS THEN
    v_ms := extract(epoch from (clock_timestamp() - t0)) * 1000;
    INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (v_ms, false, SQLSTATE || ' | ' || SQLERRM);
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.inventory i WHERE i.user_id = v_user AND i.id NOT IN (SELECT id FROM inv_before);
  UPDATE public.inventory i SET quantity = b.quantity FROM inv_before b WHERE i.id = b.id AND i.quantity <> b.quantity;
  DELETE FROM public.code_redemptions WHERE code_id = v_id;
  DELETE FROM public.redemption_codes WHERE id = v_id;
END $$;