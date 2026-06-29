CREATE OR REPLACE FUNCTION public.sweep_expired_crews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n integer;
BEGIN
  -- Only delete crew rows that are NOT currently attached to a ship.
  -- Crews assigned to an existing ship stay until the player removes them.
  WITH expired AS (
    SELECT i.id
    FROM public.inventory i
    LEFT JOIN public.ships_owned s
      ON s.id::text = (i.meta->>'assigned_ship_id')
    WHERE i.item_type = 'crew'
      AND i.meta IS NOT NULL
      AND (i.meta->>'expires_at') IS NOT NULL
      AND (i.meta->>'expires_at')::timestamptz <= now()
      AND s.id IS NULL                       -- ship no longer exists
      AND (i.meta->>'assigned_ship_id') IS NULL  -- never assigned, just stale
  )
  DELETE FROM public.inventory inv
  USING expired e
  WHERE inv.id = e.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;