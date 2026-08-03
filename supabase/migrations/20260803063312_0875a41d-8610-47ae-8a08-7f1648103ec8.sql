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
  IF _hours IS NULL OR _hours NOT IN (6,12) THEN RAISE EXCEPTION 'مدة غير صحيحة — الحد الأقصى 12 ساعة'; END IF;
  PERFORM public._trade_assert_eligible(_uid, 'self');
  PERFORM public.trade_expire_sweep();

  SELECT count(*) INTO _cnt FROM public.trade_offers WHERE creator_id=_uid AND status='active';
  IF _cnt >= 5 THEN RAISE EXCEPTION 'الحد الأقصى 5 عروض مقايضة نشطة'; END IF;

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

  SELECT g.item_id INTO _dup
    FROM public._trade_norm_items(_give) g
    JOIN public._trade_norm_items(_want) w ON w.item_id = g.item_id
   LIMIT 1;
  IF _dup IS NOT NULL THEN
    RAISE EXCEPTION 'لا يمكنك طلب نفس العنصر الذي تقدّمه — يجب أن يكون الطلب مختلفاً تماماً';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -50, 0, 0);

  INSERT INTO public.trade_offers(creator_id, expires_at, note, creator_ip, creator_device)
  VALUES (_uid, now() + (LEAST(_hours,12) || ' hours')::interval, NULLIF(left(COALESCE(_note,''),120),''),
          public._client_ip(), public._client_ua())
  RETURNING id INTO _offer;

  FOR r IN SELECT * FROM public._trade_norm_items(_give) LOOP
    INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
    VALUES (_offer, 'give', r.item_type, r.item_id, r.quantity);
    PERFORM public._trade_take(_uid, r.item_type, r.item_id, r.quantity);
  END LOOP;
  FOR r IN SELECT * FROM public._trade_norm_items(_want) LOOP
    INSERT INTO public.trade_offer_items(offer_id, side, item_type, item_id, quantity)
    VALUES (_offer, 'want', r.item_type, r.item_id, r.quantity);
  END LOOP;

  INSERT INTO public.trade_audit(offer_id, actor_id, action, details)
  VALUES (_offer, _uid, 'create', jsonb_build_object('give', _give, 'want', _want, 'hours', LEAST(_hours,12), 'fee_gems', 50));

  RETURN _offer;
END;
$function$;

UPDATE public.trade_offers
   SET expires_at = LEAST(expires_at, now() + interval '12 hours')
 WHERE status = 'active' AND expires_at > now() + interval '12 hours';