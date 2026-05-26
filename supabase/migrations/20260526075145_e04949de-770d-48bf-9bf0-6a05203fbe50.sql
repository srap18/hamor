CREATE OR REPLACE FUNCTION public.get_player_crews(_player_id uuid)
RETURNS TABLE(item_id text, ship_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.item_id,
         (i.meta->>'assigned_ship_id') AS ship_id
  FROM public.inventory i
  WHERE i.user_id = _player_id
    AND i.item_type = 'crew'
    AND i.meta IS NOT NULL
    AND (i.meta->>'assigned_ship_id') IS NOT NULL
    AND (
      (i.meta->>'expires_at') IS NULL
      OR (i.meta->>'expires_at')::timestamptz > now()
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_player_crews(uuid) TO anon, authenticated;