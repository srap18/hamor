
CREATE OR REPLACE FUNCTION public.ludo_cleanup_empty_room()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.ludo_rooms r
  WHERE r.id = OLD.room_id
    AND r.status IN ('waiting','finished','cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.ludo_players p WHERE p.room_id = r.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_ludo_cleanup_empty_room ON public.ludo_players;
CREATE TRIGGER trg_ludo_cleanup_empty_room
AFTER DELETE ON public.ludo_players
FOR EACH ROW EXECUTE FUNCTION public.ludo_cleanup_empty_room();

CREATE OR REPLACE FUNCTION public.ludo_cleanup_stale_rooms()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM public.ludo_rooms r
    WHERE NOT EXISTS (SELECT 1 FROM public.ludo_players p WHERE p.room_id = r.id)
       OR (r.status = 'waiting' AND r.created_at < now() - INTERVAL '15 minutes')
       OR (r.status IN ('finished','cancelled') AND r.updated_at < now() - INTERVAL '1 hour')
    RETURNING 1
  )
  SELECT count(*) INTO n FROM deleted;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ludo_cleanup_stale_rooms() TO authenticated;

SELECT public.ludo_cleanup_stale_rooms();
