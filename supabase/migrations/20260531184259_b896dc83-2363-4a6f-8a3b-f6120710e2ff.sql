CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid:=auth.uid(); _nid uuid; _count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _price_coins<0 OR _price_coins>100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp<50 OR _max_hp>1000000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  SELECT count(*) INTO _count FROM public.ships_owned WHERE user_id=_uid;
  IF _count >= 3 THEN RAISE EXCEPTION 'الحد الأقصى 3 سفن — بِع سفينة قبل الشراء'; END IF;
  PERFORM public._pay_coins_with_gem_fallback(_uid,_price_coins);
  INSERT INTO public.ships_owned(user_id,template_id,catalog_code,at_sea,hp,max_hp)
    VALUES(_uid,_template_id,_code,false,_max_hp,_max_hp) RETURNING id INTO _nid;
  RETURN _nid;
END $function$;

GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text, integer, bigint, integer) TO authenticated;