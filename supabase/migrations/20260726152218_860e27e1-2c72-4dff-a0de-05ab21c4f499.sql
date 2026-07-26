
-- 1) Audit table
CREATE TABLE IF NOT EXISTS public.payment_delivery_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id        text,
  user_id       uuid,
  pack_id       text,
  kind          text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pda_user_created ON public.payment_delivery_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pda_txn ON public.payment_delivery_audit (txn_id);
CREATE INDEX IF NOT EXISTS idx_pda_kind_created ON public.payment_delivery_audit (kind, created_at DESC);

GRANT SELECT ON public.payment_delivery_audit TO authenticated;
GRANT ALL    ON public.payment_delivery_audit TO service_role;

ALTER TABLE public.payment_delivery_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_view_delivery_audit" ON public.payment_delivery_audit;
CREATE POLICY "admins_view_delivery_audit"
  ON public.payment_delivery_audit
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'moderator'::app_role)
  );

DROP POLICY IF EXISTS "service_role_manage_delivery_audit" ON public.payment_delivery_audit;
CREATE POLICY "service_role_manage_delivery_audit"
  ON public.payment_delivery_audit
  USING (auth.role() = 'service_role');

-- 2) Helper: single insert path (SECURITY DEFINER callers pass everything).
CREATE OR REPLACE FUNCTION public._log_payment_delivery(
  _txn_id text,
  _user   uuid,
  _pack   text,
  _kind   text,
  _detail jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.payment_delivery_audit(txn_id, user_id, pack_id, kind, detail)
    VALUES (_txn_id, _user, _pack, _kind, coalesce(_detail, '{}'::jsonb));
  EXCEPTION WHEN OTHERS THEN
    -- Audit failure must never break a paid delivery.
    NULL;
  END;
END $$;

-- 3) Patch grant_paddle_purchase to log currency + VIP + Elite VIP + shield conversion
CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer,
  _shield_days integer, _vip_days integer, _env text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing record;
  v_shield_item text;
  v_shield_qty  int;
  v_elite_level int;
  v_elite_expires timestamptz;
  v_blocked boolean;
BEGIN
  SELECT purchases_blocked INTO v_blocked FROM public.profiles WHERE id = _user;
  IF coalesce(v_blocked, false) THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true, 'reason', 'purchases_blocked');
  END IF;

  SELECT * INTO v_existing FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;
  IF found AND v_existing.granted THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'pack_id', v_existing.pack_id);
  END IF;

  INSERT INTO public.paddle_purchases (
    user_id, paddle_transaction_id, pack_id, status, amount_cents,
    granted, granted_at, environment,
    granted_gems, granted_coins, granted_rubies, granted_shield_days, granted_vip_days
  )
  VALUES (
    _user, _txn_id, _pack_id, 'paid', _amount_cents,
    true, now(), _env,
    coalesce(_gems,0), coalesce(_coins,0), coalesce(_rubies,0),
    coalesce(_shield_days,0), coalesce(_vip_days,0)
  )
  ON CONFLICT (paddle_transaction_id) DO UPDATE
    SET status = 'paid',
        granted = true,
        granted_at = now(),
        granted_gems        = EXCLUDED.granted_gems,
        granted_coins       = EXCLUDED.granted_coins,
        granted_rubies      = EXCLUDED.granted_rubies,
        granted_shield_days = EXCLUDED.granted_shield_days,
        granted_vip_days    = EXCLUDED.granted_vip_days;

  IF coalesce(_gems,0) > 0 OR coalesce(_coins,0) > 0 OR coalesce(_rubies,0) > 0 THEN
    UPDATE public.profiles
       SET gems   = coalesce(gems,0)   + coalesce(_gems,0),
           coins  = coalesce(coins,0)  + coalesce(_coins,0),
           rubies = coalesce(rubies,0) + coalesce(_rubies,0)
     WHERE id = _user;

    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'currency', jsonb_build_object(
      'gems',   coalesce(_gems,0),
      'coins',  coalesce(_coins,0),
      'rubies', coalesce(_rubies,0),
      'amount_cents', coalesce(_amount_cents,0),
      'env', _env
    ));
  END IF;

  IF coalesce(_shield_days,0) > 0 THEN
    IF _shield_days >= 30 AND _shield_days % 30 = 0 THEN
      v_shield_item := 'shield_30d'; v_shield_qty := _shield_days / 30;
    ELSIF _shield_days >= 7 AND _shield_days % 7 = 0 THEN
      v_shield_item := 'shield_7d';  v_shield_qty := _shield_days / 7;
    ELSE
      v_shield_item := 'shield_1d';  v_shield_qty := _shield_days;
    END IF;
    PERFORM public.grant_inventory_item(_user, 'shield', v_shield_item, v_shield_qty);
    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'shield', jsonb_build_object(
      'item_id', v_shield_item, 'qty', v_shield_qty, 'shield_days', _shield_days
    ));
  END IF;

  IF coalesce(_vip_days,0) > 0 THEN
    UPDATE public.profiles
       SET vip_expires_at = GREATEST(coalesce(vip_expires_at, now()), now()) + make_interval(days => _vip_days)
     WHERE id = _user;
    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'vip', jsonb_build_object(
      'vip_days', _vip_days
    ));
  END IF;

  v_elite_level := CASE
    WHEN _pack_id ~ '^elite_vip_[1-5]_monthly$'
      THEN substring(_pack_id from 'elite_vip_([1-5])_monthly')::int
    ELSE NULL
  END;
  IF v_elite_level IS NOT NULL THEN
    v_elite_expires := now() + interval '30 days';
    UPDATE public.profiles
       SET elite_vip_level = v_elite_level,
           elite_vip_expires_at = GREATEST(coalesce(elite_vip_expires_at, now()), v_elite_expires)
     WHERE id = _user;
    PERFORM public._log_payment_delivery(_txn_id, _user, _pack_id, 'elite_vip', jsonb_build_object(
      'level', v_elite_level, 'expires_at', v_elite_expires
    ));
  END IF;

  BEGIN
    INSERT INTO public.economy_audit (user_id, reason, ref, gems_delta, coins_delta, rubies_delta, meta)
    VALUES (
      _user, 'paddle_grant', _txn_id,
      coalesce(_gems,0), coalesce(_coins,0), coalesce(_rubies,0),
      jsonb_build_object('pack_id', _pack_id, 'env', _env, 'amount_cents', _amount_cents)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'granted', true, 'pack_id', _pack_id);
END;
$function$;

-- 4) Patch grant_pack_items to log each freshly delivered item.
CREATE OR REPLACE FUNCTION public.grant_pack_items(_txn_id text, _user uuid, _items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  it jsonb;
  v_type text; v_id text; v_qty int;
  v_inserted int := 0;
  v_did_insert boolean;
  v_pack text;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'inserted', 0);
  END IF;

  SELECT pack_id INTO v_pack FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_type := it->>'itemType';
    v_id := it->>'itemId';
    v_qty := COALESCE((it->>'qty')::int, 0);
    IF v_qty <= 0 OR v_type IS NULL OR v_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.paddle_purchase_items(paddle_transaction_id, item_type, item_id, qty)
    VALUES (_txn_id, v_type, v_id, v_qty)
    ON CONFLICT (paddle_transaction_id, item_type, item_id) DO NOTHING;

    GET DIAGNOSTICS v_did_insert = ROW_COUNT;
    IF v_did_insert THEN
      PERFORM public.grant_inventory_item(_user, v_type, v_id, v_qty);
      v_inserted := v_inserted + 1;
      PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'item', jsonb_build_object(
        'item_type', v_type, 'item_id', v_id, 'qty', v_qty
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END $function$;

-- 5) Patch grant_pack_ships to log delivered ships batch-by-batch.
CREATE OR REPLACE FUNCTION public.grant_pack_ships(
  _txn_id text, _user uuid,
  _phoenix integer, _dragon_t1 integer, _dragon_t2 integer, _dragon_t3 integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_have int;
  v_missing int;
  v_total int := 0;
  v_pack text;
BEGIN
  IF _txn_id IS NULL OR _user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT pack_id INTO v_pack FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;

  PERFORM set_config('app.allow_reward_ship_storage_overflow', 'true', true);

  IF COALESCE(_phoenix,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=31;
    v_missing := _phoenix - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 31, 13000, 13000, false, 'ship-lvl-31', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
      PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'ship', jsonb_build_object(
        'template_id', 31, 'catalog_code', 'ship-lvl-31', 'qty', v_missing
      ));
    END IF;
  END IF;

  IF COALESCE(_dragon_t1,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=34;
    v_missing := _dragon_t1 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 34, 20000, 20000, false, 'dragon-t1', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
      PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'ship', jsonb_build_object(
        'template_id', 34, 'catalog_code', 'dragon-t1', 'qty', v_missing
      ));
    END IF;
  END IF;

  IF COALESCE(_dragon_t2,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=35;
    v_missing := _dragon_t2 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 35, 40000, 40000, false, 'dragon-t2', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
      PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'ship', jsonb_build_object(
        'template_id', 35, 'catalog_code', 'dragon-t2', 'qty', v_missing
      ));
    END IF;
  END IF;

  IF COALESCE(_dragon_t3,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=36;
    v_missing := _dragon_t3 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 36, 60000, 60000, false, 'dragon-t3', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
      PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'ship', jsonb_build_object(
        'template_id', 36, 'catalog_code', 'dragon-t3', 'qty', v_missing
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'inserted', v_total);
END $function$;
