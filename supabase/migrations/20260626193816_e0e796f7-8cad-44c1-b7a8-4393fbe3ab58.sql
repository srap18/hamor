CREATE OR REPLACE FUNCTION public.vr_join_room(_room uuid, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.voice_rooms%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _r
  FROM public.voice_rooms
  WHERE id = _room AND closed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF public.vr_is_banned(_room, _uid) THEN
    RAISE EXCEPTION 'banned_from_room';
  END IF;

  IF _r.locked AND _r.owner_id <> _uid THEN
    RAISE EXCEPTION 'room_locked';
  END IF;

  IF _r.is_private
     AND _r.password IS NOT NULL
     AND _r.password <> COALESCE(_password, '')
     AND _r.owner_id <> _uid THEN
    RAISE EXCEPTION 'wrong_password';
  END IF;

  INSERT INTO public.voice_room_members(room_id, user_id, role, seat_index, last_seen_at)
  VALUES (
    _room,
    _uid,
    CASE WHEN _r.owner_id = _uid THEN 'owner'::public.voice_room_role ELSE 'listener'::public.voice_room_role END,
    CASE WHEN _r.owner_id = _uid THEN 0 ELSE NULL END,
    now()
  )
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET last_seen_at = now(),
        role = CASE
          WHEN public.voice_room_members.role = 'owner' THEN public.voice_room_members.role
          WHEN _r.owner_id = _uid THEN 'owner'::public.voice_room_role
          ELSE public.voice_room_members.role
        END,
        seat_index = CASE
          WHEN _r.owner_id = _uid AND public.voice_room_members.seat_index IS NULL THEN 0
          ELSE public.voice_room_members.seat_index
        END;

  INSERT INTO public.voice_room_logs(room_id, actor_id, action)
  VALUES (_room, _uid, 'joined');
END
$$;

GRANT EXECUTE ON FUNCTION public.vr_join_room(uuid, text) TO authenticated;