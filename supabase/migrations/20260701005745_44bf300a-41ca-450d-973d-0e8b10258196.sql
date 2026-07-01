
CREATE OR REPLACE FUNCTION public.admin_get_player_dragon_equipment(_player uuid)
RETURNS TABLE(id uuid, slot text, rarity text, name text, equipped boolean, smelted boolean, acquired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  RETURN QUERY
    SELECT d.id, d.slot, d.rarity, d.name, d.equipped, COALESCE(d.smelted,false), d.acquired_at
    FROM public.dragon_equipment d
    WHERE d.user_id = _player
    ORDER BY d.slot, d.acquired_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_dragon_equipment(_row_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  DELETE FROM public.dragon_equipment WHERE id = _row_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_player_dragon_equipment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_dragon_equipment(uuid) TO authenticated;
