-- 1) Repair existing owned ships with invalid catalog codes
UPDATE public.ships_owned so
SET catalog_code = m.good_code,
    template_id = sc.sort_order
FROM (VALUES
  ('ship-lvl-31','phoenix'),
  ('ship-lvl-34','dragon-t1'),
  ('ship-lvl-35','dragon-t2'),
  ('ship-lvl-36','dragon-t3')
) AS m(bad_code, good_code)
JOIN public.ship_catalog sc ON sc.code = m.good_code
WHERE so.catalog_code = m.bad_code;

-- ships with a numeric junk code fall back to their template level code
UPDATE public.ships_owned so
SET catalog_code = sc.code, template_id = sc.sort_order
FROM public.ship_catalog sc
WHERE sc.code = 'ship-lvl-' || COALESCE(so.template_id, 1)
  AND so.catalog_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.ship_catalog c WHERE c.code = so.catalog_code);

-- 2) Fix the grant function so future pack purchases store real catalog codes
CREATE OR REPLACE FUNCTION public.grant_pack_ships(_user uuid, _txn_id text, _phoenix integer DEFAULT 0, _dragon_t1 integer DEFAULT 0, _dragon_t2 integer DEFAULT 0, _dragon_t3 integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_pack text;
  v_spec jsonb := jsonb_build_array(
    jsonb_build_object('tpl', 31, 'code', 'phoenix',   'n', COALESCE(_phoenix,0)),
    jsonb_build_object('tpl', 34, 'code', 'dragon-t1', 'n', COALESCE(_dragon_t1,0)),
    jsonb_build_object('tpl', 35, 'code', 'dragon-t2', 'n', COALESCE(_dragon_t2,0)),
    jsonb_build_object('tpl', 36, 'code', 'dragon-t3', 'n', COALESCE(_dragon_t3,0))
  );
  it jsonb;
  v_n int; v_tpl int; v_code text; v_hp int; v_sort int;
  v_ins int;
BEGIN
  IF _txn_id IS NULL OR _user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT pack_id INTO v_pack FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;
  PERFORM set_config('app.allow_reward_ship_storage_overflow', 'true', true);

  FOR it IN SELECT * FROM jsonb_array_elements(v_spec) LOOP
    v_n := (it->>'n')::int;
    CONTINUE WHEN v_n <= 0;
    v_tpl := (it->>'tpl')::int;
    v_code := it->>'code';

    SELECT max_hp, sort_order INTO v_hp, v_sort FROM public.ship_catalog WHERE code = v_code LIMIT 1;
    CONTINUE WHEN v_hp IS NULL;

    -- ledger is the single source of truth: selling the ships must NOT re-trigger a grant
    INSERT INTO public.paddle_purchase_ships(paddle_transaction_id, template_id, qty, user_id)
    VALUES (_txn_id, v_tpl, v_n, _user)
    ON CONFLICT (paddle_transaction_id, template_id) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    CONTINUE WHEN v_ins = 0;

    INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
    SELECT _user, COALESCE(v_sort, v_tpl), v_hp, v_hp, false, v_code, _txn_id, true FROM generate_series(1, v_n);
    v_total := v_total + v_n;
    PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'ship', jsonb_build_object(
      'template_id', v_tpl, 'catalog_code', v_code, 'qty', v_n
    ));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ships', v_total);
END $$;