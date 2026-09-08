CREATE OR REPLACE FUNCTION public._trade_assert_eligible(_uid uuid, _who text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _lvl int; _allowed boolean;
BEGIN
  IF public.trade_globally_disabled() THEN
    RAISE EXCEPTION 'تم ايقاف المقايضة مؤقتاً من قبل الإدارة.';
  END IF;
  SELECT COALESCE(trade_allowed, true) INTO _allowed FROM public.profiles WHERE id = _uid;
  IF _allowed IS NULL THEN RAISE EXCEPTION 'حساب غير موجود'; END IF;
  IF NOT _allowed THEN
    IF _who = 'self' THEN RAISE EXCEPTION 'المقايضة معطلة على حسابك بواسطة الإدارة.';
    ELSE RAISE EXCEPTION 'المقايضة معطلة على حساب الطرف الآخر بواسطة الإدارة.'; END IF;
  END IF;
  SELECT level INTO _lvl FROM public.user_market WHERE user_id = _uid;
  IF COALESCE(_lvl,1) < 20 THEN
    IF _who = 'self' THEN RAISE EXCEPTION 'يجب ترقية سوق السفن إلى المستوى 20 لفتح نظام المقايضة.';
    ELSE RAISE EXCEPTION 'الطرف الآخر لم يصل إلى المستوى 20 في سوق السفن.'; END IF;
  END IF;
END $function$;