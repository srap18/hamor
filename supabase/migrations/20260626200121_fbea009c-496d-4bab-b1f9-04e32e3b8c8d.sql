
-- Allow any room member to claim an empty seat (become speaker) without mod approval
CREATE OR REPLACE FUNCTION public.vr_take_seat(_room uuid, _seat int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _r public.voice_rooms%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _r FROM public.voice_rooms WHERE id = _room AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'room_not_found'; END IF;
  IF public.vr_is_banned(_room, _uid) THEN RAISE EXCEPTION 'banned_from_room'; END IF;
  IF _r.listeners_only AND _r.owner_id <> _uid THEN RAISE EXCEPTION 'listeners_only'; END IF;
  IF _seat < 0 OR _seat >= _r.seat_count THEN RAISE EXCEPTION 'invalid_seat'; END IF;

  -- Seat must be free
  IF EXISTS (SELECT 1 FROM public.voice_room_members WHERE room_id=_room AND seat_index=_seat) THEN
    RAISE EXCEPTION 'seat_taken';
  END IF;

  -- Ensure user is a member; then promote to speaker on this seat
  INSERT INTO public.voice_room_members(room_id, user_id, role, seat_index, last_seen_at)
  VALUES (_room, _uid, 'speaker'::public.voice_room_role, _seat, now())
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET
    seat_index = _seat,
    role = CASE WHEN public.voice_room_members.role IN ('owner','mod') THEN public.voice_room_members.role ELSE 'speaker'::public.voice_room_role END,
    muted = false,
    last_seen_at = now();

  INSERT INTO public.voice_room_logs(room_id, actor_id, target_id, action, last_seen_at)
  VALUES (_room, _uid, _uid, 'took_seat', now());
END;
$function$;

-- Leave seat (go back to listener)
CREATE OR REPLACE FUNCTION public.vr_leave_seat(_room uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.voice_room_members
    SET seat_index = NULL,
        role = CASE WHEN role IN ('owner','mod') THEN role ELSE 'listener'::public.voice_room_role END,
        muted = true,
        last_seen_at = now()
  WHERE room_id = _room AND user_id = _uid;
END;
$function$;

-- Heartbeat: client calls every ~20s; stale members are filtered out client-side
CREATE OR REPLACE FUNCTION public.vr_heartbeat(_room uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.voice_room_members
    SET last_seen_at = now()
  WHERE room_id = _room AND user_id = auth.uid();
$$;

-- Make resolve request idempotent (no error if already gone)
CREATE OR REPLACE FUNCTION public.vr_resolve_request(_req uuid, _accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _rq public.voice_room_requests%ROWTYPE;
  _r public.voice_rooms%ROWTYPE;
  _uid uuid := auth.uid();
  _free_seat int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _rq FROM public.voice_room_requests WHERE id = _req;
  IF NOT FOUND THEN RETURN; END IF;          -- idempotent
  IF _rq.status <> 'pending' THEN RETURN; END IF;

  SELECT * INTO _r FROM public.voice_rooms WHERE id = _rq.room_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.vr_is_mod_or_owner(_rq.room_id, _uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF _accept THEN
    SELECT g.s INTO _free_seat
    FROM generate_series(1, _r.seat_count - 1) g(s)
    WHERE NOT EXISTS (SELECT 1 FROM public.voice_room_members WHERE room_id=_rq.room_id AND seat_index=g.s)
    ORDER BY g.s LIMIT 1;

    IF _free_seat IS NULL THEN RAISE EXCEPTION 'no_free_seat'; END IF;

    INSERT INTO public.voice_room_members(room_id, user_id, role, seat_index, last_seen_at)
    VALUES (_rq.room_id, _rq.user_id, 'speaker'::public.voice_room_role, _free_seat, now())
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET role = 'speaker'::public.voice_room_role, seat_index = _free_seat, muted = false, last_seen_at = now();

    UPDATE public.voice_room_requests SET status='accepted', resolved_at=now(), resolved_by=_uid WHERE id=_req;
  ELSE
    UPDATE public.voice_room_requests SET status='rejected', resolved_at=now(), resolved_by=_uid WHERE id=_req;
  END IF;
END;
$function$;
