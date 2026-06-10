
CREATE OR REPLACE FUNCTION public.consume_inventory_item(_item_id text, _item_type text, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _remaining int;
  _take int;
  _total int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count < 1 OR _count > 100 THEN RAISE EXCEPTION 'bad count'; END IF;

  -- Make sure the user actually has enough across all usable stacks.
  SELECT COALESCE(SUM(quantity), 0)::int INTO _total
    FROM public.inventory
   WHERE user_id = _uid
     AND item_id = _item_id
     AND item_type = _item_type
     AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);

  IF _total < _count THEN RAISE EXCEPTION 'not enough items'; END IF;

  _remaining := _count;

  -- Consume from individual stacks one row at a time. Never touch other stacks.
  FOR _row IN
    SELECT id, quantity
      FROM public.inventory
     WHERE user_id = _uid
       AND item_id = _item_id
       AND item_type = _item_type
       AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
       AND quantity > 0
     ORDER BY acquired_at ASC NULLS LAST, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN _remaining <= 0;
    _take := LEAST(_row.quantity, _remaining);

    IF _row.quantity - _take <= 0 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - _take WHERE id = _row.id;
    END IF;

    _remaining := _remaining - _take;
  END LOOP;

  IF _remaining > 0 THEN
    RAISE EXCEPTION 'not enough items';
  END IF;
END $function$;
