
CREATE OR REPLACE FUNCTION public.ludo_cleanup_stale()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.ludo_rooms r
     SET status = 'abandoned'
   WHERE r.status = 'waiting'
     AND (
       r.created_at < now() - interval '10 minutes'
       OR NOT EXISTS (
         SELECT 1 FROM public.ludo_players p
         JOIN public.profiles pr ON pr.id = p.user_id
         WHERE p.room_id = r.id
           AND pr.online_at > now() - interval '90 seconds'
       )
     );

  UPDATE public.ludo_rooms r
     SET status = 'abandoned', finished_at = COALESCE(r.finished_at, now())
   WHERE r.status = 'playing'
     AND NOT EXISTS (
       SELECT 1 FROM public.ludo_players p
       JOIN public.profiles pr ON pr.id = p.user_id
       WHERE p.room_id = r.id
         AND pr.online_at > now() - interval '3 minutes'
     );

  DELETE FROM public.ludo_rooms
   WHERE status IN ('abandoned','finished')
     AND COALESCE(finished_at, created_at) < now() - interval '1 hour';
END;
$$;

SELECT public.ludo_cleanup_stale();
