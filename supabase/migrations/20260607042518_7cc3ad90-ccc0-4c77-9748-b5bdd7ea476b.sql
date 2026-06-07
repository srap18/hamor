-- Drop duplicate partial unique index (was causing ambiguous ON CONFLICT inference)
DROP INDEX IF EXISTS public.inventory_user_item_uniq;

-- Fix grant_inventory_item: include the partial-index WHERE clause so ON CONFLICT matches
CREATE OR REPLACE FUNCTION public.grant_inventory_item(_user uuid, _item_type text, _item_id text, _qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(_qty,0) <= 0 THEN RETURN; END IF;
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
  VALUES (_user, _item_type, _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
END $function$;