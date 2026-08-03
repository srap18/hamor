-- ============ 1) PAID SHIP GRANT IDEMPOTENCY LEDGER ============
CREATE TABLE IF NOT EXISTS public.paddle_purchase_ships (
  paddle_transaction_id text NOT NULL,
  template_id integer NOT NULL,
  qty integer NOT NULL,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paddle_transaction_id, template_id)
);
GRANT ALL ON public.paddle_purchase_ships TO service_role;
ALTER TABLE public.paddle_purchase_ships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pps_admin_read" ON public.paddle_purchase_ships FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

-- backfill from ships already delivered
INSERT INTO public.paddle_purchase_ships(paddle_transaction_id, template_id, qty, user_id)
SELECT source_txn_id, template_id, count(*)::int, (array_agg(user_id))[1]
  FROM public.ships_owned
 WHERE source_txn_id IS NOT NULL
 GROUP BY source_txn_id, template_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_pack_ships(_txn_id text, _user uuid, _phoenix integer, _dragon_t1 integer, _dragon_t2 integer, _dragon_t3 integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int := 0;
  v_pack text;
  v_spec jsonb := jsonb_build_array(
    jsonb_build_object('tpl', 31, 'code', 'ship-lvl-31', 'hp', 13000, 'n', COALESCE(_phoenix,0)),
    jsonb_build_object('tpl', 34, 'code', 'ship-lvl-34', 'hp', 20000, 'n', COALESCE(_dragon_t1,0)),
    jsonb_build_object('tpl', 35, 'code', 'ship-lvl-35', 'hp', 26000, 'n', COALESCE(_dragon_t2,0)),
    jsonb_build_object('tpl', 36, 'code', 'ship-lvl-36', 'hp', 33000, 'n', COALESCE(_dragon_t3,0))
  );
  it jsonb;
  v_n int; v_tpl int; v_code text; v_hp int;
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
    v_hp := (it->>'hp')::int;

    -- ledger is the single source of truth: selling the ships must NOT re-trigger a grant
    INSERT INTO public.paddle_purchase_ships(paddle_transaction_id, template_id, qty, user_id)
    VALUES (_txn_id, v_tpl, v_n, _user)
    ON CONFLICT (paddle_transaction_id, template_id) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    CONTINUE WHEN v_ins = 0;

    INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
    SELECT _user, v_tpl, v_hp, v_hp, false, v_code, _txn_id, true FROM generate_series(1, v_n);
    v_total := v_total + v_n;
    PERFORM public._log_payment_delivery(_txn_id, _user, v_pack, 'ship', jsonb_build_object(
      'template_id', v_tpl, 'catalog_code', v_code, 'qty', v_n
    ));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ships', v_total);
END $function$;

-- ============ 2) FISH PRICE FREEZE: no silent time loss ============
CREATE OR REPLACE FUNCTION public.buy_market_freeze(_hours integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _now timestamptz := now();
  _cur_started timestamptz;
  _cur_until timestamptz;
  _cur_frozen jsonb;
  _new_until timestamptz;
  _new_started timestamptz;
  _snapshot jsonb;
  _cap timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;

  _cap := _now + interval '24 hours';

  SELECT ums.freeze_started_at, ums.freeze_until, COALESCE(ums.frozen_prices, '{}'::jsonb)
    INTO _cur_started, _cur_until, _cur_frozen
    FROM public.user_market_state ums
   WHERE ums.user_id = _uid
   FOR UPDATE;

  IF _cur_until IS NOT NULL AND _cur_until > _now THEN
    -- Extension: never truncate paid hours — refuse instead of silently losing time.
    IF _cur_until + (_hours || ' hours')::interval > _cap THEN
      RAISE EXCEPTION 'لا يمكن التمديد: الحد الأقصى 24 ساعة تجميد. المتبقي لديك % ساعة — استخدمه أولاً.',
        round(EXTRACT(epoch FROM (_cur_until - _now))/3600.0, 1);
    END IF;
    _new_started := GREATEST(COALESCE(_cur_started, _now), _now - interval '24 hours');
    _new_until   := _cur_until + (_hours || ' hours')::interval;
    _snapshot    := COALESCE(_cur_frozen, '{}'::jsonb);
  ELSE
    _new_started := _now;
    _new_until   := _now + (_hours || ' hours')::interval;
    SELECT COALESCE(jsonb_object_agg(fmp.fish_id,
      GREATEST(
        COALESCE(fps.min_price, fmp.min_price, 0.0001)::numeric,
        LEAST(
          COALESCE(fps.max_price, fmp.max_price, 999999999)::numeric,
          COALESCE(NULLIF(fmp.current_price, 0), 1)::numeric
        )
      )
    ), '{}'::jsonb)
      INTO _snapshot
      FROM public.fish_market_prices fmp
      LEFT JOIN public.fish_price_settings fps ON fps.fish_id = fmp.fish_id;
  END IF;

  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;

  INSERT INTO public.user_market_state(user_id, freeze_started_at, freeze_until, rot_freeze_offset_seconds, frozen_prices, updated_at)
  VALUES (_uid, _new_started, _new_until, 0, _snapshot, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_started_at = EXCLUDED.freeze_started_at,
        freeze_until = EXCLUDED.freeze_until,
        rot_freeze_offset_seconds = 0,
        frozen_prices = EXCLUDED.frozen_prices,
        updated_at = _now;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'market_rot_freeze', -_cost, 'gems',
          jsonb_build_object('hours', _hours, 'extended', (_cur_until IS NOT NULL AND _cur_until > _now), 'until', _new_until));

  RETURN _new_until;
END;
$function$;

-- ============ 3) TRADE SYSTEM ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trade_allowed boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.trade_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','expired')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  accepted_by uuid,
  creator_ip text,
  creator_device text,
  acceptor_ip text,
  acceptor_device text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_offers_active ON public.trade_offers(status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_creator ON public.trade_offers(creator_id, status);
GRANT SELECT ON public.trade_offers TO authenticated;
GRANT ALL ON public.trade_offers TO service_role;
ALTER TABLE public.trade_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trade_offers_read" ON public.trade_offers FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.trade_offer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.trade_offers(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('give','want')),
  item_type text NOT NULL CHECK (item_type IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb')),
  item_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 999),
  UNIQUE (offer_id, side, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_offer_items_offer ON public.trade_offer_items(offer_id);
GRANT SELECT ON public.trade_offer_items TO authenticated;
GRANT ALL ON public.trade_offer_items TO service_role;
ALTER TABLE public.trade_offer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trade_items_read" ON public.trade_offer_items FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.trade_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid,
  action text NOT NULL,
  actor_id uuid,
  counterparty_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  device text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_audit_offer ON public.trade_audit(offer_id);
CREATE INDEX IF NOT EXISTS idx_trade_audit_actor ON public.trade_audit(actor_id, created_at DESC);
GRANT ALL ON public.trade_audit TO service_role;
ALTER TABLE public.trade_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trade_audit_admin_read" ON public.trade_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'moderator'::app_role));

-- eligibility
CREATE OR REPLACE FUNCTION public._trade_assert_eligible(_uid uuid, _who text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _lvl int; _allowed boolean;
BEGIN
  SELECT COALESCE(trade_allowed, true) INTO _allowed FROM public.profiles WHERE id = _uid;
  IF _allowed IS NULL THEN RAISE EXCEPTION 'حساب غير موجود'; END IF;
  IF NOT _allowed THEN
    IF _who = 'self' THEN RAISE EXCEPTION 'المقايضة معطلة على حسابك بواسطة الإدارة.';
    ELSE RAISE EXCEPTION 'المقايضة معطلة على حساب الطرف الآخر بواسطة الإدارة.'; END IF;
  END IF;
  SELECT level INTO _lvl FROM public.user_market WHERE user_id = _uid;
  IF COALESCE(_lvl,1) < 28 THEN
    IF _who = 'self' THEN RAISE EXCEPTION 'يجب ترقية سوق السفن إلى المستوى 28 لفتح نظام المقايضة.';
    ELSE RAISE EXCEPTION 'الطرف الآخر لم يصل إلى المستوى 28 في سوق السفن.'; END IF;
  END IF;
END $$;

-- normalize + validate an items payload
CREATE OR REPLACE FUNCTION public._trade_norm_items(_items jsonb)
RETURNS TABLE(item_type text, item_id text, quantity integer)
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار عنصر واحد على الأقل';
  END IF;
  IF jsonb_array_length(_items) > 6 THEN RAISE EXCEPTION 'الحد الأقصى 6 عناصر لكل جهة'; END IF;
  RETURN QUERY
  SELECT (e->>'item_type')::text, (e->>'item_id')::text, (e->>'quantity')::int
    FROM jsonb_array_elements(_items) e;
END $$;

-- take items from inventory (locks rows); raises on shortage
CREATE OR REPLACE FUNCTION public._trade_take(_uid uuid, _items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_id uuid; v_q int;
BEGIN
  FOR r IN SELECT * FROM public._trade_norm_items(_items) ORDER BY 1,2 LOOP
    IF r.quantity IS NULL OR r.quantity <= 0 OR r.quantity > 999 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF r.item_type IS NULL OR r.item_id IS NULL THEN RAISE EXCEPTION 'عنصر غير صحيح'; END IF;
    IF r.item_type NOT IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') THEN
      RAISE EXCEPTION 'هذا النوع غير مسموح في المقايضة';
    END IF;
    SELECT id, quantity INTO v_id, v_q FROM public.inventory
      WHERE user_id = _uid AND item_type = r.item_type AND item_id = r.item_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
      FOR UPDATE;
    IF v_id IS NULL OR v_q < r.quantity THEN
      RAISE EXCEPTION 'لا تملك الكمية المطلوبة من (%)', r.item_id;
    END IF;
    IF v_q = r.quantity THEN
      DELETE FROM public.inventory WHERE id = v_id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - r.quantity WHERE id = v_id;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._trade_give_back(_uid uuid, _offer uuid, _side text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT item_type, item_id, quantity FROM public.trade_offer_items
            WHERE offer_id = _offer AND side = _side LOOP
    PERFORM public.grant_inventory_item(_uid, r.item_type, r.item_id, r.quantity);
  END LOOP;
END $$;

-- expire sweep (safe to call from anywhere)
CREATE OR REPLACE FUNCTION public.trade_expire_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record; n int := 0;
BEGIN
  FOR o IN SELECT id, creator_id FROM public.trade_offers
            WHERE status = 'active' AND expires_at <= now()
            ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
    PERFORM public._trade_give_back(o.creator_id, o.id, 'give');
    UPDATE public.trade_offers SET status='expired', updated_at=now() WHERE id=o.id AND status='active';
    INSERT INTO public.trade_audit(offer_id, action, actor_id, detail)
      VALUES (o.id, 'expired', o.creator_id, '{}'::jsonb);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.trade_create(_give jsonb, _want jsonb, _hours integer DEFAULT 24, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _offer uuid; _cnt int; r record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF _hours IS NULL OR _hours NOT IN (6,12,24,48) THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;
  PERFORM public._trade_assert_eligible(_uid, 'self');
  PERFORM public.trade_expire_sweep();

  SELECT count(*) INTO _cnt FROM public.trade_offers WHERE creator_id=_uid AND status='active';
  IF _cnt >= 5 THEN RAISE EXCEPTION 'الحد الأقصى 5 عروض مقايضة نشطة'; END IF;

  INSERT INTO public.trade_offers(creator_id, expires_at, note, creator_ip, creator_device)
  VALUES (_uid, now() + (_hours || ' hours')::interval, NULLIF(left(COALESCE(_note,''),120),''),
          public._client_ip(), public._client_ua())
  RETURNING id INTO _offer;

  FOR r IN SELECT * FROM public._trade_norm_items(_give) LOOP
    INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
    VALUES (_offer, 'give', r.item_type, r.item_id, r.quantity);
  END LOOP;
  FOR r IN SELECT * FROM public._trade_norm_items(_want) LOOP
    IF r.quantity IS NULL OR r.quantity <= 0 OR r.quantity > 999 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF r.item_type NOT IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') THEN
      RAISE EXCEPTION 'هذا النوع غير مسموح في المقايضة';
    END IF;
    INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
    VALUES (_offer, 'want', r.item_type, r.item_id, r.quantity);
  END LOOP;

  -- escrow: remove offered items from the creator's inventory immediately
  PERFORM public._trade_take(_uid, _give);

  INSERT INTO public.trade_audit(offer_id, action, actor_id, detail, ip, device)
  VALUES (_offer, 'created', _uid, jsonb_build_object('give', _give, 'want', _want, 'hours', _hours),
          public._client_ip(), public._client_ua());

  RETURN _offer;
END $$;

CREATE OR REPLACE FUNCTION public.trade_cancel(_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO o FROM public.trade_offers WHERE id = _offer_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'العرض غير موجود'; END IF;
  IF o.creator_id <> _uid AND NOT public.has_role(_uid,'admin'::app_role) THEN RAISE EXCEPTION 'ليس عرضك'; END IF;
  IF o.status <> 'active' THEN RAISE EXCEPTION 'العرض غير نشط'; END IF;
  PERFORM public._trade_give_back(o.creator_id, o.id, 'give');
  UPDATE public.trade_offers SET status='cancelled', updated_at=now() WHERE id=o.id AND status='active';
  INSERT INTO public.trade_audit(offer_id, action, actor_id, detail, ip, device)
  VALUES (o.id, 'cancelled', _uid, '{}'::jsonb, public._client_ip(), public._client_ua());
END $$;

CREATE OR REPLACE FUNCTION public.trade_accept(_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record; _uid uuid := auth.uid(); _want jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  PERFORM public._trade_assert_eligible(_uid, 'self');

  SELECT * INTO o FROM public.trade_offers WHERE id = _offer_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'العرض غير موجود'; END IF;
  IF o.status <> 'active' THEN RAISE EXCEPTION 'العرض لم يعد متاحاً'; END IF;
  IF o.expires_at <= now() THEN RAISE EXCEPTION 'انتهت مدة العرض'; END IF;
  IF o.creator_id = _uid THEN RAISE EXCEPTION 'لا يمكنك قبول عرضك'; END IF;
  PERFORM public._trade_assert_eligible(o.creator_id, 'other');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_type',item_type,'item_id',item_id,'quantity',quantity)), '[]'::jsonb)
    INTO _want FROM public.trade_offer_items WHERE offer_id=o.id AND side='want';

  -- take the requested items from the acceptor (locks + validates ownership)
  PERFORM public._trade_take(_uid, _want);

  -- deliver: escrowed items -> acceptor, requested items -> creator
  PERFORM public._trade_give_back(_uid, o.id, 'give');
  PERFORM public._trade_give_back(o.creator_id, o.id, 'want');

  UPDATE public.trade_offers
     SET status='completed', accepted_by=_uid, completed_at=now(), updated_at=now(),
         acceptor_ip=public._client_ip(), acceptor_device=public._client_ua()
   WHERE id=o.id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'تم تنفيذ العرض من لاعب آخر'; END IF;

  INSERT INTO public.trade_audit(offer_id, action, actor_id, counterparty_id, detail, ip, device)
  VALUES (o.id, 'completed', _uid, o.creator_id, jsonb_build_object('want', _want), public._client_ip(), public._client_ua());

  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.trade_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _res jsonb;
BEGIN
  PERFORM public.trade_expire_sweep();
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO _res FROM (
    SELECT jsonb_build_object(
      'id', o.id,
      'creator_id', o.creator_id,
      'creator_name', p.display_name,
      'creator_avatar', p.avatar_url,
      'created_at', o.created_at,
      'expires_at', o.expires_at,
      'note', o.note,
      'mine', (o.creator_id = auth.uid()),
      'give', (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_type',i.item_type,'item_id',i.item_id,'quantity',i.quantity)),'[]'::jsonb)
                 FROM public.trade_offer_items i WHERE i.offer_id=o.id AND i.side='give'),
      'want', (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_type',i.item_type,'item_id',i.item_id,'quantity',i.quantity)),'[]'::jsonb)
                 FROM public.trade_offer_items i WHERE i.offer_id=o.id AND i.side='want')
    ) AS x
    FROM public.trade_offers o
    JOIN public.profiles p ON p.id = o.creator_id
    WHERE o.status='active' AND o.expires_at > now()
    ORDER BY o.created_at DESC
    LIMIT 100
  ) t;
  RETURN _res;
END $$;

CREATE OR REPLACE FUNCTION public.trade_my_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _lvl int; _allowed boolean;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'auth'); END IF;
  SELECT COALESCE(trade_allowed,true) INTO _allowed FROM public.profiles WHERE id=_uid;
  SELECT level INTO _lvl FROM public.user_market WHERE user_id=_uid;
  RETURN jsonb_build_object(
    'eligible', COALESCE(_allowed,true) AND COALESCE(_lvl,1) >= 28,
    'trade_allowed', COALESCE(_allowed,true),
    'market_level', COALESCE(_lvl,1)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_trade_allowed(_user uuid, _allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET trade_allowed = _allowed WHERE id = _user;
  INSERT INTO public.trade_audit(action, actor_id, counterparty_id, detail)
  VALUES ('admin_set_trade_allowed', auth.uid(), _user, jsonb_build_object('allowed', _allowed));
END $$;

REVOKE ALL ON FUNCTION public._trade_take(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trade_give_back(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._trade_assert_eligible(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trade_create(jsonb, jsonb, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trade_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trade_accept(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trade_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trade_my_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trade_expire_sweep() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_trade_allowed(uuid, boolean) TO authenticated;