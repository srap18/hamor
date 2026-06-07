
CREATE OR REPLACE FUNCTION public.admin_get_player_inventory(_player uuid)
RETURNS TABLE(id uuid, item_type text, item_id text, quantity int, meta jsonb, acquired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  RETURN QUERY
    SELECT i.id, i.item_type, i.item_id, i.quantity, i.meta, i.acquired_at
    FROM public.inventory i
    WHERE i.user_id = _player
    ORDER BY i.item_type, i.acquired_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_inventory_quantity(_row_id uuid, _quantity int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid; _it text; _iid text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  _quantity := GREATEST(0, COALESCE(_quantity, 0));
  SELECT user_id, item_type, item_id INTO _uid, _it, _iid FROM public.inventory WHERE id = _row_id;
  IF _uid IS NULL THEN RAISE EXCEPTION 'row not found'; END IF;
  IF _quantity = 0 THEN
    DELETE FROM public.inventory WHERE id = _row_id;
  ELSE
    UPDATE public.inventory SET quantity = _quantity WHERE id = _row_id;
  END IF;
  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_set_inventory_quantity', _uid,
    jsonb_build_object('row_id', _row_id, 'item_type', _it, 'item_id', _iid, 'quantity', _quantity));
END $$;

CREATE OR REPLACE FUNCTION public.admin_grant_inventory_item(_player uuid, _item_type text, _item_id text, _quantity int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  _quantity := GREATEST(1, COALESCE(_quantity, 1));
  IF _item_type NOT IN ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield') THEN
    RAISE EXCEPTION 'bad item_type';
  END IF;
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
  VALUES (_player, _item_type, _item_id, _quantity)
  ON CONFLICT (user_id, item_type, item_id) WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_grant_inventory_item', _player,
    jsonb_build_object('item_type', _item_type, 'item_id', _item_id, 'quantity', _quantity));
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_player_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_inventory_quantity(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_inventory_item(uuid, text, text, int) TO authenticated;
