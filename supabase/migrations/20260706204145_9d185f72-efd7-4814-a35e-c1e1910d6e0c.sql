
CREATE OR REPLACE FUNCTION public.ludo_quick_match(_players integer DEFAULT 2)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room_id uuid;
  _seat int;
  _colors text[] := ARRAY['green','red','yellow','blue'];
  _count int;
  _max int;
BEGIN
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _players NOT IN (2, 4) THEN
    RAISE EXCEPTION 'invalid_players';
  END IF;

  -- If already in a waiting/playing room, return it
  SELECT p.room_id INTO _room_id
  FROM public.ludo_players p
  JOIN public.ludo_rooms r ON r.id = p.room_id
  WHERE p.user_id = _uid AND r.status IN ('waiting','playing')
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF _room_id IS NOT NULL THEN
    RETURN _room_id;
  END IF;

  -- Find ANY waiting room with a free seat (ignore max_players requirement — join whatever's open)
  SELECT r.id, r.max_players INTO _room_id, _max
  FROM public.ludo_rooms r
  WHERE r.status = 'waiting'
    AND (SELECT COUNT(*) FROM public.ludo_players p WHERE p.room_id = r.id) < r.max_players
  ORDER BY r.max_players = _players DESC, r.created_at ASC
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

  INSERT INTO public.ludo_players (room_id, user_id, seat, color)
  VALUES (_room_id, _uid, _seat, _colors[_seat + 1]);

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
$function$;
