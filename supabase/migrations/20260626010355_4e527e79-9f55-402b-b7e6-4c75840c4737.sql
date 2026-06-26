
CREATE OR REPLACE FUNCTION public.sweep_expired_crews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  WITH expired AS (
    SELECT i.id, i.item_id, (i.meta->>'assigned_ship_id') AS sid
    FROM public.inventory i
    WHERE i.item_type = 'crew'
      AND i.meta IS NOT NULL
      AND (i.meta->>'expires_at') IS NOT NULL
      AND (i.meta->>'expires_at')::timestamptz <= now()
  ),
  to_delete AS (
    SELECT e.id
    FROM expired e
    LEFT JOIN public.ships_owned s
      ON s.id::text = e.sid
    WHERE NOT (
      e.item_id = 'sailor'
      AND s.id IS NOT NULL
      AND COALESCE(s.at_sea, false) = true
      AND s.fishing_started_at IS NOT NULL
    )
  )
  DELETE FROM public.inventory inv
  USING to_delete d
  WHERE inv.id = d.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sweep_expired_crews() TO authenticated, service_role;
