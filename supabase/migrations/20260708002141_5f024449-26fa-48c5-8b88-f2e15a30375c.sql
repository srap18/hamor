CREATE OR REPLACE FUNCTION public.ludo_cleanup_stale_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove rooms with no players.
  DELETE FROM public.ludo_moves WHERE room_id IN (
    SELECT r.id FROM public.ludo_rooms r
    LEFT JOIN public.ludo_players p ON p.room_id = r.id
    GROUP BY r.id HAVING count(p.id) = 0
  );

  DELETE FROM public.ludo_rooms r
   WHERE NOT EXISTS (SELECT 1 FROM public.ludo_players p WHERE p.room_id = r.id);

  -- Remove waiting rooms if they are old or any existing player is not online.
  DELETE FROM public.ludo_rooms r
   WHERE r.status = 'waiting'
     AND (
       r.created_at < now() - interval '10 minutes'
       OR EXISTS (
         SELECT 1
           FROM public.ludo_players p
           LEFT JOIN public.profiles pr ON pr.id = p.user_id
          WHERE p.room_id = r.id
            AND COALESCE(pr.online_at, r.created_at) <= now() - interval '90 seconds'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.ludo_players p WHERE p.room_id = r.id
       )
     );

  -- Remove playing rooms if any player has been offline for more than 3 minutes.
  DELETE FROM public.ludo_rooms r
   WHERE r.status = 'playing'
     AND EXISTS (
       SELECT 1
         FROM public.ludo_players p
         LEFT JOIN public.profiles pr ON pr.id = p.user_id
        WHERE p.room_id = r.id
          AND COALESCE(pr.online_at, r.started_at, r.created_at) <= now() - interval '3 minutes'
     );

  -- Finish games that only have one remaining player.
  UPDATE public.ludo_rooms r
     SET status = 'finished',
         winner_id = (SELECT p.user_id FROM public.ludo_players p WHERE p.room_id = r.id LIMIT 1),
         finished_at = COALESCE(r.finished_at, now()),
         last_dice = NULL,
         turn_deadline = NULL
   WHERE r.status = 'playing'
     AND (SELECT count(*) FROM public.ludo_players p WHERE p.room_id = r.id) = 1
     AND r.winner_id IS NULL;

  -- Keep active games moving when a turn expires.
  UPDATE public.ludo_rooms r
     SET current_turn_seat = public.ludo_next_active_seat(r.id, r.current_turn_seat, r.max_players),
         last_dice = NULL,
         turn_deadline = now() + interval '30 seconds'
   WHERE r.status = 'playing'
     AND r.turn_deadline IS NOT NULL
     AND r.turn_deadline <= now()
     AND (SELECT count(*) FROM public.ludo_players p WHERE p.room_id = r.id) > 1;

  -- Repair missing current turn player.
  UPDATE public.ludo_rooms r
     SET current_turn_seat = public.ludo_next_active_seat(r.id, r.current_turn_seat, r.max_players),
         last_dice = NULL,
         turn_deadline = now() + interval '30 seconds'
   WHERE r.status = 'playing'
     AND NOT EXISTS (
       SELECT 1 FROM public.ludo_players p
       WHERE p.room_id = r.id AND p.seat = r.current_turn_seat
     )
     AND (SELECT count(*) FROM public.ludo_players p WHERE p.room_id = r.id) > 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ludo_cleanup_stale_rooms() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ludo_cleanup_stale_rooms() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ludo_cleanup_stale()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ludo_cleanup_stale_rooms();
$$;

GRANT EXECUTE ON FUNCTION public.ludo_cleanup_stale() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ludo_cleanup_stale() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ludo_quick_match(_players integer DEFAULT 2)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room_id uuid;
  _seat int;
  _count int;
  _max int;
  _color text;
BEGIN
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _players NOT IN (2, 4) THEN
    RAISE EXCEPTION 'invalid_players';
  END IF;

  PERFORM public.ludo_cleanup_stale_rooms();

  SELECT p.room_id INTO _room_id
  FROM public.ludo_players p
  JOIN public.ludo_rooms r ON r.id = p.room_id
  WHERE p.user_id = _uid
    AND r.status IN ('waiting','playing')
    AND r.max_players = _players
    AND NOT EXISTS (
      SELECT 1
        FROM public.ludo_players px
        LEFT JOIN public.profiles pr ON pr.id = px.user_id
       WHERE px.room_id = r.id
         AND COALESCE(pr.online_at, r.created_at) <= now() - interval '90 seconds'
    )
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF _room_id IS NOT NULL THEN
    RETURN _room_id;
  END IF;

  SELECT r.id, r.max_players INTO _room_id, _max
  FROM public.ludo_rooms r
  WHERE r.status = 'waiting'
    AND r.max_players = _players
    AND (SELECT COUNT(*) FROM public.ludo_players p WHERE p.room_id = r.id) < r.max_players
    AND NOT EXISTS (
      SELECT 1
        FROM public.ludo_players p
        LEFT JOIN public.profiles pr ON pr.id = p.user_id
       WHERE p.room_id = r.id
         AND COALESCE(pr.online_at, r.created_at) <= now() - interval '90 seconds'
    )
  ORDER BY r.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF _room_id IS NULL THEN
    INSERT INTO public.ludo_rooms (host_id, max_players)
    VALUES (_uid, _players)
    RETURNING id, max_players INTO _room_id, _max;

    INSERT INTO public.ludo_players (room_id, user_id, seat, color)
    VALUES (_room_id, _uid, 0, 'green');
    RETURN _room_id;
  END IF;

  SELECT COUNT(*) INTO _count FROM public.ludo_players WHERE room_id = _room_id;
  _seat := _count;
  _color := CASE
    WHEN _max = 2 AND _seat = 1 THEN 'yellow'
    WHEN _seat = 0 THEN 'green'
    WHEN _seat = 1 THEN 'red'
    WHEN _seat = 2 THEN 'yellow'
    ELSE 'blue'
  END;

  INSERT INTO public.ludo_players (room_id, user_id, seat, color)
  VALUES (_room_id, _uid, _seat, _color);

  IF _count + 1 >= _max THEN
    UPDATE public.ludo_rooms
       SET status = 'playing',
           started_at = now(),
           turn_deadline = now() + interval '30 seconds',
           current_turn_seat = 0
     WHERE id = _room_id;
  END IF;

  RETURN _room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ludo_quick_match(integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ludo_quick_match(integer) FROM PUBLIC, anon;

SELECT public.ludo_cleanup_stale_rooms();