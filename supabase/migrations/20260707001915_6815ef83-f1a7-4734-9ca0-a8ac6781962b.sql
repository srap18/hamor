CREATE OR REPLACE FUNCTION public.ludo_join_room(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _count int;
  _seat int;
  _color text;
BEGIN
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND OR _room.status <> 'waiting' THEN
    RAISE EXCEPTION 'room_unavailable';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ludo_players WHERE room_id = _room_id AND user_id = _uid) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO _count FROM public.ludo_players WHERE room_id = _room_id;
  IF _count >= _room.max_players THEN
    RAISE EXCEPTION 'room_full';
  END IF;

  _seat := _count;
  _color := CASE
    WHEN _room.max_players = 2 AND _seat = 1 THEN 'yellow'
    WHEN _seat = 0 THEN 'green'
    WHEN _seat = 1 THEN 'red'
    WHEN _seat = 2 THEN 'yellow'
    ELSE 'blue'
  END;

  INSERT INTO public.ludo_players (room_id, user_id, seat, color)
  VALUES (_room_id, _uid, _seat, _color);

  IF _count + 1 >= _room.max_players THEN
    UPDATE public.ludo_rooms
       SET status = 'playing',
           started_at = now(),
           turn_deadline = now() + interval '30 seconds',
           current_turn_seat = 0
     WHERE id = _room_id;
  END IF;
END;
$function$;