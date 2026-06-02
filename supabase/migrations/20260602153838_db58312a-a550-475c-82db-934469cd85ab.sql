CREATE OR REPLACE FUNCTION public.buy_trader_unlock()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _owned_qty int;
  _ends timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::int INTO _owned_qty
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = 'trader'
    AND quantity > 0;

  IF _owned_qty > 0 THEN
    _ends := now() + interval '10 hours';
    INSERT INTO public.user_market_state(user_id, trader_until)
      VALUES (_uid, _ends)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
          updated_at = now();
    RETURN _ends;
  END IF;

  SELECT price_gems INTO _cost
  FROM public.client_item_prices
  WHERE item_type = 'crew' AND item_id = 'trader';

  IF _cost IS NULL OR _cost <= 0 THEN
    SELECT price_gems INTO _cost
    FROM public.items_catalog
    WHERE code = 'trader' AND active = true;
  END IF;

  IF _cost IS NULL OR _cost <= 0 THEN
    RAISE EXCEPTION 'سعر التاجر غير متوفر';
  END IF;

  UPDATE public.profiles
     SET gems = gems - _cost
   WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'جواهر غير كافية';
  END IF;

  _ends := now() + interval '10 hours';
  INSERT INTO public.user_market_state(user_id, trader_until)
    VALUES (_uid, _ends)
  ON CONFLICT (user_id) DO UPDATE
    SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
        updated_at = now();

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
    VALUES (_uid, 'trader_unlock', -_cost, 'gems', jsonb_build_object('hours', 10, 'source', 'market_button'));

  RETURN _ends;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_trader_unlock() TO authenticated;