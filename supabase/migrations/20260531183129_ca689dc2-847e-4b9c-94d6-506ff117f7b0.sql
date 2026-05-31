
CREATE OR REPLACE FUNCTION public.buy_with_coins_gem_fallback(
  _item_id text,
  _item_type text,
  _coins_cost bigint,
  _meta jsonb DEFAULT NULL,
  _count integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _price bigint; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;

  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;

  IF _item_type IN ('frame','background','name_frame') THEN
    _count := 1;
  END IF;

  _total := _price * _count;

  -- Pays from coins; if insufficient, tops up the shortage from gems (1 gem = 1000 coins).
  PERFORM public._pay_coins_with_gem_fallback(_uid, _total);

  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $$;

GRANT EXECUTE ON FUNCTION public.buy_with_coins_gem_fallback(text, text, bigint, jsonb, integer) TO authenticated;
