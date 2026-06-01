CREATE OR REPLACE FUNCTION public.grant_inventory_item(_user uuid, _item_type text, _item_id text, _qty integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(_qty,0) <= 0 THEN RETURN; END IF;
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
  VALUES (_user, _item_type, _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
  DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
END $$;

GRANT EXECUTE ON FUNCTION public.grant_inventory_item(uuid, text, text, integer) TO service_role;