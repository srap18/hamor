DROP FUNCTION IF EXISTS public.ludo_cleanup_stale_rooms();

CREATE OR REPLACE FUNCTION public.ludo_cleanup_stale_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.ludo_moves WHERE room_id IN (
    SELECT r.id FROM public.ludo_rooms r
    LEFT JOIN public.ludo_players p ON p.room_id = r.id
    GROUP BY r.id HAVING count(p.id) = 0
  );
  DELETE FROM public.ludo_rooms r
   WHERE NOT EXISTS (SELECT 1 FROM public.ludo_players p WHERE p.room_id = r.id);

  UPDATE public.ludo_rooms r
     SET status = 'finished',
         winner_id = (SELECT p.user_id FROM public.ludo_players p WHERE p.room_id = r.id LIMIT 1),
         turn_deadline = NULL
   WHERE r.status = 'playing'
     AND (SELECT count(*) FROM public.ludo_players p WHERE p.room_id = r.id) = 1
     AND r.winner_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ludo_cleanup_stale_rooms() TO authenticated;