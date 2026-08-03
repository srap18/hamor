CREATE OR REPLACE FUNCTION public.trade_globally_disabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT (value->>'disabled')::boolean FROM public.economy_settings WHERE key='trade_system'), false)
$$;

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
  IF COALESCE(_lvl,1) < 28 THEN
    IF _who = 'self' THEN RAISE EXCEPTION 'يجب ترقية سوق السفن إلى المستوى 28 لفتح نظام المقايضة.';
    ELSE RAISE EXCEPTION 'الطرف الآخر لم يصل إلى المستوى 28 في سوق السفن.'; END IF;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.trade_my_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _lvl int; _allowed boolean; _off boolean := public.trade_globally_disabled();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'auth', 'system_disabled', _off); END IF;
  SELECT COALESCE(trade_allowed,true) INTO _allowed FROM public.profiles WHERE id=_uid;
  SELECT level INTO _lvl FROM public.user_market WHERE user_id=_uid;
  RETURN jsonb_build_object(
    'eligible', (NOT _off) AND COALESCE(_allowed,true) AND COALESCE(_lvl,1) >= 28,
    'trade_allowed', COALESCE(_allowed,true),
    'system_disabled', _off,
    'market_level', COALESCE(_lvl,1)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.trade_globally_disabled() TO authenticated, anon;