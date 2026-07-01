
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
    -- Auto-unequip cosmetics on the profile if this was the equipped one.
    IF _it = 'frame' THEN
      UPDATE public.profiles SET avatar_frame = NULL WHERE id = _uid AND avatar_frame = _iid;
    ELSIF _it = 'name_frame' THEN
      UPDATE public.profiles SET name_frame = NULL WHERE id = _uid AND name_frame = _iid;
    ELSIF _it = 'bubble_frame' THEN
      UPDATE public.profiles SET bubble_frame = NULL WHERE id = _uid AND bubble_frame = _iid;
    ELSIF _it = 'profile_frame' THEN
      UPDATE public.profiles SET profile_frame = NULL WHERE id = _uid AND profile_frame = _iid;
    ELSIF _it = 'background' THEN
      UPDATE public.profiles SET selected_bg_id = NULL WHERE id = _uid AND selected_bg_id = _iid;
    END IF;
  ELSE
    UPDATE public.inventory SET quantity = _quantity WHERE id = _row_id;
  END IF;
  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_set_inventory_quantity', _uid,
    jsonb_build_object('row_id', _row_id, 'item_type', _it, 'item_id', _iid, 'quantity', _quantity));
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_inventory_quantity(uuid, int) TO authenticated;
