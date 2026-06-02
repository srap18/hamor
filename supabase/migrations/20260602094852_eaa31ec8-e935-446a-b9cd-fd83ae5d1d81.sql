CREATE OR REPLACE FUNCTION public.assign_crew_to_ship(_ship_id uuid, _crew_id text)
 RETURNS TABLE(inventory_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship_owner uuid;
  _inv_id uuid;
  _qty integer;
  _expires timestamptz := now() + interval '24 hours';
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _ship_id IS NULL THEN RAISE EXCEPTION 'missing ship'; END IF;
  IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew'; END IF;

  SELECT user_id INTO _ship_owner
  FROM public.ships_owned
  WHERE id = _ship_id
  FOR UPDATE;

  IF _ship_owner IS NULL OR _ship_owner <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  DELETE FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = _crew_id
    AND meta->>'assigned_ship_id' = _ship_id::text
    AND (meta->>'expires_at') IS NOT NULL
    AND (meta->>'expires_at')::timestamptz <= now();

  -- Only the trader is fleet-exclusive; all other crews are per-ship.
  IF _crew_id = 'trader' THEN
    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _uid
        AND item_type = 'crew'
        AND item_id = _crew_id
        AND meta->>'assigned_ship_id' IS NOT NULL
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN
      RAISE EXCEPTION 'crew already active globally';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _uid
        AND item_type = 'crew'
        AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN
      RAISE EXCEPTION 'ship already has this crew';
    END IF;
  END IF;

  SELECT id, quantity INTO _inv_id, _qty
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = _crew_id
    AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at, id
  LIMIT 1
  FOR UPDATE;

  IF _inv_id IS NULL THEN RAISE EXCEPTION 'no such crew'; END IF;

  IF _qty <= 1 THEN
    UPDATE public.inventory
       SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
     WHERE id = _inv_id;
    _new_id := _inv_id;
  ELSE
    UPDATE public.inventory
       SET quantity = quantity - 1
     WHERE id = _inv_id;

    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, 'crew', _crew_id, 1, jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires))
    RETURNING id INTO _new_id;
  END IF;

  inventory_id := _new_id;
  expires_at := _expires;
  RETURN NEXT;
END;
$function$;