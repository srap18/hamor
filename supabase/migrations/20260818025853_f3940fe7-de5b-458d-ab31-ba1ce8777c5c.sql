DO $$
DECLARE
  v_user uuid := '456112a7-0530-4098-bdab-b28418570115';
  t0 timestamptz;
  v_extra jsonb := (SELECT extra_rewards FROM public.redemption_codes WHERE code = 'N6QCU9T2');
  v_dummy uuid;
BEGIN
  CREATE TEMP TABLE inv_before ON COMMIT DROP AS
    SELECT id, quantity FROM public.inventory WHERE user_id = v_user;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.allow_reward_ship_storage_overflow', 'true', true);

  t0 := clock_timestamp();
  PERFORM 1 FROM public.redemption_codes WHERE upper(regexp_replace(code, '[\s-]+', '', 'g')) = 'N6QCU9T2';
  INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (extract(epoch from (clock_timestamp()-t0))*1000, true, 'lookup');

  t0 := clock_timestamp();
  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  SELECT v_user, COALESCE(e->>'item_kind','misc'), e->>'item_id', SUM(GREATEST(COALESCE((e->>'quantity')::int,1),1))
  FROM jsonb_array_elements(v_extra) e
  WHERE COALESCE(e->>'type','')='item' AND (e->>'item_id') IS NOT NULL
  GROUP BY COALESCE(e->>'item_kind','misc'), e->>'item_id'
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (extract(epoch from (clock_timestamp()-t0))*1000, true, 'inventory_insert');

  t0 := clock_timestamp();
  INSERT INTO public.redemption_codes (code, reward_type, quantity, max_uses, active, note)
  VALUES ('ZZD'||floor(random()*100000)::text, 'bundle', 1, 1, true, 'diag') RETURNING id INTO v_dummy;
  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_dummy, v_user);
  INSERT INTO public._redeem_test_log(ms, ok, msg) VALUES (extract(epoch from (clock_timestamp()-t0))*1000, true, 'code_redemptions_insert');

  DELETE FROM public.code_redemptions WHERE code_id = v_dummy;
  DELETE FROM public.redemption_codes WHERE id = v_dummy;

  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.inventory i WHERE i.user_id = v_user AND i.id NOT IN (SELECT id FROM inv_before);
  UPDATE public.inventory i SET quantity = b.quantity FROM inv_before b WHERE i.id = b.id AND i.quantity <> b.quantity;
END $$;