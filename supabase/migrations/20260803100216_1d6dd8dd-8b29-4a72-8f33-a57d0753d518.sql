-- 1) Normalizer: aggregate duplicates + sanitize
CREATE OR REPLACE FUNCTION public._trade_norm_items(_items jsonb)
RETURNS TABLE(item_type text, item_id text, quantity int)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار عنصر واحد على الأقل';
  END IF;
  IF jsonb_array_length(_items) > 12 THEN RAISE EXCEPTION 'الحد الأقصى 6 عناصر لكل جهة'; END IF;

  RETURN QUERY
  SELECT lower(btrim(e->>'item_type')) AS item_type,
         btrim(e->>'item_id') AS item_id,
         LEAST(9999, SUM(GREATEST(0, COALESCE((e->>'quantity')::int, 0))))::int AS quantity
    FROM jsonb_array_elements(_items) e
   GROUP BY 1, 2;
END
$function$;

-- 2) Escrow/take: sum across all unassigned inventory rows, row-locked
CREATE OR REPLACE FUNCTION public._trade_take(_uid uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_row record; v_need int;
BEGIN
  FOR r IN SELECT * FROM public._trade_norm_items(_items) ORDER BY 1,2 LOOP
    IF r.item_type IS NULL OR r.item_id IS NULL OR r.item_type = '' OR r.item_id = '' THEN
      RAISE EXCEPTION 'عنصر غير صحيح';
    END IF;
    IF r.quantity IS NULL OR r.quantity <= 0 OR r.quantity > 10 THEN
      RAISE EXCEPTION 'كمية غير صحيحة';
    END IF;
    IF r.item_type NOT IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') THEN
      RAISE EXCEPTION 'هذا النوع غير مسموح في المقايضة';
    END IF;

    v_need := r.quantity;
    FOR v_row IN
      SELECT id, quantity FROM public.inventory
       WHERE user_id = _uid AND item_type = r.item_type AND item_id = r.item_id
         AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
       ORDER BY quantity DESC
       FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      IF v_row.quantity <= v_need THEN
        DELETE FROM public.inventory WHERE id = v_row.id;
        v_need := v_need - v_row.quantity;
      ELSE
        UPDATE public.inventory SET quantity = quantity - v_need WHERE id = v_row.id;
        v_need := 0;
      END IF;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION 'لا تملك الكمية المطلوبة من (%)', r.item_id;
    END IF;
  END LOOP;
END
$function$;

-- 3) trade_create: fixed helper call, whitelist on both sides, stronger dup guard, correct audit column
CREATE OR REPLACE FUNCTION public.trade_create(_give jsonb, _want jsonb, _hours integer, _note text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _offer uuid; _cnt int; r record;
        _give_total int := 0; _want_total int := 0; _dup text;
        _give_kinds int := 0; _want_kinds int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF _hours IS NULL OR _hours NOT IN (6,12) THEN RAISE EXCEPTION 'مدة غير صحيحة — الحد الأقصى 12 ساعة'; END IF;
  PERFORM public._trade_assert_eligible(_uid, 'self');
  PERFORM public.trade_expire_sweep();

  SELECT count(*) INTO _cnt FROM public.trade_offers WHERE creator_id=_uid AND status='active';
  IF _cnt >= 5 THEN RAISE EXCEPTION 'الحد الأقصى 5 عروض مقايضة نشطة'; END IF;

  FOR r IN SELECT * FROM public._trade_norm_items(_give) LOOP
    IF r.item_type IS NULL OR r.item_id IS NULL OR r.item_type = '' OR r.item_id = '' THEN
      RAISE EXCEPTION 'عنصر غير صحيح'; END IF;
    IF r.quantity IS NULL OR r.quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF r.quantity > 10 THEN RAISE EXCEPTION 'الحد الأقصى 10 قطع لكل عنصر في المقايضة'; END IF;
    IF r.item_type NOT IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') THEN
      RAISE EXCEPTION 'هذا النوع غير مسموح في المقايضة';
    END IF;
    _give_total := _give_total + r.quantity;
    _give_kinds := _give_kinds + 1;
  END LOOP;

  FOR r IN SELECT * FROM public._trade_norm_items(_want) LOOP
    IF r.item_type IS NULL OR r.item_id IS NULL OR r.item_type = '' OR r.item_id = '' THEN
      RAISE EXCEPTION 'عنصر غير صحيح'; END IF;
    IF r.quantity IS NULL OR r.quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF r.quantity > 10 THEN RAISE EXCEPTION 'الحد الأقصى 10 قطع لكل عنصر في المقايضة'; END IF;
    IF r.item_type NOT IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') THEN
      RAISE EXCEPTION 'هذا النوع غير مسموح في المقايضة';
    END IF;
    _want_total := _want_total + r.quantity;
    _want_kinds := _want_kinds + 1;
  END LOOP;

  IF _give_kinds > 6 OR _want_kinds > 6 THEN RAISE EXCEPTION 'الحد الأقصى 6 عناصر لكل جهة'; END IF;
  IF _give_total > 20 OR _want_total > 20 THEN
    RAISE EXCEPTION 'الحد الأقصى 20 قطعة في كل جهة';
  END IF;
  IF _want_total > GREATEST(3, _give_total * 3) THEN
    RAISE EXCEPTION 'طلب غير معقول: لا يمكنك طلب أكثر من % قطعة مقابل ما تقدّمه', GREATEST(3, _give_total * 3);
  END IF;

  SELECT g.item_id INTO _dup
    FROM public._trade_norm_items(_give) g
    JOIN public._trade_norm_items(_want) w
      ON w.item_id = g.item_id OR w.item_type = g.item_type
   LIMIT 1;
  IF _dup IS NOT NULL THEN
    RAISE EXCEPTION 'لا يمكنك طلب نفس العنصر الذي تقدّمه — يجب أن يكون الطلب مختلفاً تماماً';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -50, 0, 0);

  INSERT INTO public.trade_offers(creator_id, expires_at, note, creator_ip, creator_device)
  VALUES (_uid, now() + (LEAST(_hours,12) || ' hours')::interval, NULLIF(left(COALESCE(_note,''),120),''),
          public._client_ip(), public._client_ua())
  RETURNING id INTO _offer;

  -- escrow everything at once (locks rows, verifies ownership across split stacks)
  PERFORM public._trade_take(_uid, _give);

  INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
  SELECT _offer, 'give', n.item_type, n.item_id, n.quantity FROM public._trade_norm_items(_give) n;

  INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
  SELECT _offer, 'want', n.item_type, n.item_id, n.quantity FROM public._trade_norm_items(_want) n;

  INSERT INTO public.trade_audit(offer_id, actor_id, action, detail, ip, device)
  VALUES (_offer, _uid, 'created',
          jsonb_build_object('give', _give, 'want', _want, 'hours', LEAST(_hours,12), 'fee_gems', 50),
          public._client_ip(), public._client_ua());

  RETURN _offer;
END;
$function$;