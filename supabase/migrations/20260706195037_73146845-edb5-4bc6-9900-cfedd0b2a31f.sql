
CREATE OR REPLACE FUNCTION public.ludo_quick_match()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room_id uuid;
  _seat int;
  _colors text[] := ARRAY['green','red','yellow','blue'];
  _count int;
  _max int;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Find oldest waiting room where I'm not already a player
  SELECT r.id, r.max_players INTO _room_id, _max
  FROM public.ludo_rooms r
  WHERE r.status = 'waiting'
    AND NOT EXISTS (
      SELECT 1 FROM public.ludo_players p
      WHERE p.room_id = r.id AND p.user_id = _uid
    )
    AND (SELECT COUNT(*) FROM public.ludo_players p WHERE p.room_id = r.id) < r.max_players
  ORDER BY r.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF _room_id IS NULL THEN
    -- No room available → create one
    INSERT INTO public.ludo_rooms (host_id, max_players)
    VALUES (_uid, 2)
    RETURNING id INTO _room_id;

    INSERT INTO public.ludo_players (room_id, user_id, seat, color)
    VALUES (_room_id, _uid, 0, 'green');
    RETURN _room_id;
  END IF;

  -- Join the found room
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
$$;

GRANT EXECUTE ON FUNCTION public.ludo_quick_match() TO authenticated;
