CREATE OR REPLACE FUNCTION public.use_crew_from_inventory(_inventory_id uuid, _ship_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.inventory%ROWTYPE;
  _ship_owner uuid;
  _crew_id text;
  _expires timestamptz := now() + interval '24 hours';
  _trader_ends timestamptz;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO _row
  FROM public.inventory
  WHERE id = _inventory_id
  FOR UPDATE;

  IF _row.id IS NULL OR _row.user_id <> _uid OR _row.item_type <> 'crew' OR _row.quantity < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _row.meta IS NOT NULL AND _row.meta->>'assigned_ship_id' IS NOT NULL THEN
    RAISE EXCEPTION 'crew already used';
  END IF;

  _crew_id := _row.item_id;

  IF _crew_id = 'trader' THEN
    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    _trader_ends := now() + interval '10 hours';
    INSERT INTO public.user_market_state(user_id, trader_until)
      VALUES (_uid, _trader_ends)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
          updated_at = now();

    RETURN jsonb_build_object('ok', true, 'kind', 'trader', 'until', _trader_ends);
  END IF;

  IF _ship_id IS NULL THEN
    RAISE EXCEPTION 'missing ship';
  END IF;

  SELECT user_id INTO _ship_owner
  FROM public.ships_owned
  WHERE id = _ship_id;

  IF _ship_owner IS NULL OR _ship_owner <> _uid THEN
    RAISE EXCEPTION 'ship not found';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE user_id = _uid
       AND destroyed_at IS NULL;

    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'repair_all');
  END IF;

  IF _crew_id IN ('fixer_1','fixer_2','fixer_3') THEN
    UPDATE public.ships_owned
       SET hp = LEAST(max_hp, hp + CASE _crew_id WHEN 'fixer_1' THEN 1000 WHEN 'fixer_2' THEN 5000 ELSE 70000 END),
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id;

    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'repair_ship');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory
    WHERE user_id = _uid
      AND item_type = 'crew'
      AND item_id = _crew_id
      AND meta->>'assigned_ship_id' = _ship_id::text
      AND COALESCE((meta->>'expires_at')::timestamptz, now() + interval '1 second') > now()
  ) THEN
    RAISE EXCEPTION 'ship already has this crew';
  END IF;

  IF _row.quantity = 1 THEN
    UPDATE public.inventory
       SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
     WHERE id = _row.id;
    _new_id := _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, 'crew', _crew_id, 1, jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires))
    RETURNING id INTO _new_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', 'assigned', 'id', _new_id, 'until', _expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_crew_from_inventory(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_trader_unlock()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _inv_id uuid;
  _ends timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT id INTO _inv_id
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = 'trader'
    AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at
  LIMIT 1;

  IF _inv_id IS NOT NULL THEN
    SELECT (public.use_crew_from_inventory(_inv_id, NULL)->>'until')::timestamptz INTO _ends;
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