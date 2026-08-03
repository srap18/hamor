DROP FUNCTION IF EXISTS public.trade_create(jsonb, jsonb, integer, text);
CREATE OR REPLACE FUNCTION public.trade_create(_give jsonb, _want jsonb, _hours integer, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _uid uuid := auth.uid(); _offer uuid; _cnt int; r record;
        _give_total int := 0; _want_total int := 0;
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
  VALUES (_offer, 'created', _uid, jsonb_build_object('give', _give, 'want', _want, 'hours', _hours),
          public._client_ip(), public._client_ua());

  RETURN _offer;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.trade_create(jsonb, jsonb, integer, text) TO authenticated;

-- cancel any existing active offers that violate the new fairness rules (items returned)
DO $do$
DECLARE o record;
BEGIN
  FOR o IN
    SELECT t.id FROM public.trade_offers t
    WHERE t.status='active'
      AND EXISTS (
        SELECT 1 FROM public.trade_offer_items i WHERE i.offer_id=t.id AND i.quantity > 10
      )
  LOOP
    PERFORM public._trade_give_back(
      (SELECT creator_id FROM public.trade_offers WHERE id=o.id), o.id, 'give');
    UPDATE public.trade_offers SET status='cancelled', updated_at=now() WHERE id=o.id;
  END LOOP;
END
$do$;