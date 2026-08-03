CREATE OR REPLACE FUNCTION public.trade_create(_give jsonb, _want jsonb, _hours integer, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _offer uuid; _cnt int; r record;
        _give_total int := 0; _want_total int := 0; _dup text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF _hours IS NULL OR _hours NOT IN (6,12,24,48) THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;
  PERFORM public._trade_assert_eligible(_uid, 'self');
  PERFORM public.trade_expire_sweep();

  SELECT count(*) INTO _cnt FROM public.trade_offers WHERE creator_id=_uid AND status='active';
  IF _cnt >= 5 THEN RAISE EXCEPTION 'الحد الأقصى 5 عروض مقايضة نشطة'; END IF;

  -- fairness validation (both sides)
  FOR r IN SELECT * FROM public._trade_norm_items(_give) LOOP
    IF r.quantity IS NULL OR r.quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF r.quantity > 10 THEN RAISE EXCEPTION 'الحد الأقصى 10 قطع لكل عنصر في المقايضة'; END IF;
    _give_total := _give_total + r.quantity;
  END LOOP;
  FOR r IN SELECT * FROM public._trade_norm_items(_want) LOOP
    IF r.quantity IS NULL OR r.quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF r.quantity > 10 THEN RAISE EXCEPTION 'الحد الأقصى 10 قطع لكل عنصر في المقايضة'; END IF;
    IF r.item_type NOT IN ('crew','weapon','shield','anti','anti_rocket','anti_nuke','anti_ad_bomb') THEN
      RAISE EXCEPTION 'هذا النوع غير مسموح في المقايضة';
    END IF;
    _want_total := _want_total + r.quantity;
  END LOOP;
  IF _give_total > 20 OR _want_total > 20 THEN
    RAISE EXCEPTION 'الحد الأقصى 20 قطعة في كل جهة';
  END IF;
  IF _want_total > GREATEST(3, _give_total * 3) THEN
    RAISE EXCEPTION 'طلب غير معقول: لا يمكنك طلب أكثر من % قطعة مقابل ما تقدّمه', GREATEST(3, _give_total * 3);
  END IF;

  -- NEW: the same item may not appear on both sides of the offer
  SELECT g.item_id INTO _dup
    FROM public._trade_norm_items(_give) g
    JOIN public._trade_norm_items(_want) w ON w.item_id = g.item_id
   LIMIT 1;
  IF _dup IS NOT NULL THEN
    RAISE EXCEPTION 'لا يمكنك طلب نفس العنصر الذي تقدّمه — يجب أن يكون الطلب مختلفاً تماماً';
  END IF;

  -- NEW: non-refundable creation fee
  PERFORM public._mutate_currency(_uid, 0, -50, 0, 0);

  INSERT INTO public.trade_offers(creator_id, expires_at, note, creator_ip, creator_device)
  VALUES (_uid, now() + (_hours || ' hours')::interval, NULLIF(left(COALESCE(_note,''),120),''),
          public._client_ip(), public._client_ua())
  RETURNING id INTO _offer;

  FOR r IN SELECT * FROM public._trade_norm_items(_give) LOOP
    INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
    VALUES (_offer, 'give', r.item_type, r.item_id, r.quantity);
  END LOOP;
  FOR r IN SELECT * FROM public._trade_norm_items(_want) LOOP
    INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
    VALUES (_offer, 'want', r.item_type, r.item_id, r.quantity);
  END LOOP;

  PERFORM public._trade_take(_uid, _give);

  INSERT INTO public.trade_audit(offer_id, action, actor_id, detail, ip, device)
  VALUES (_offer, 'created', _uid, jsonb_build_object('give', _give, 'want', _want, 'hours', _hours, 'fee_gems', 50),
          public._client_ip(), public._client_ua());

  RETURN _offer;
END
$function$;

CREATE OR REPLACE FUNCTION public.trade_accept(_offer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- NEW: non-refundable trade fee for the acceptor
  PERFORM public._mutate_currency(_uid, 0, -50, 0, 0);

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
  VALUES (o.id, 'completed', _uid, o.creator_id, jsonb_build_object('want', _want, 'fee_gems', 50), public._client_ip(), public._client_ua());

  RETURN jsonb_build_object('ok', true);
END
$function$;