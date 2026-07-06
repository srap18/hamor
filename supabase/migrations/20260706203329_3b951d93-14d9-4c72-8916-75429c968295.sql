-- Allow both admins and moderators to access the Ludo prototype consistently.
-- The frontend already treats admin + moderator as allowed; these backend rules now match it.

ALTER POLICY "admins view rooms"
ON public.ludo_rooms
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins insert rooms"
ON public.ludo_rooms
WITH CHECK (public.is_admin(auth.uid()));

ALTER POLICY "admins update rooms"
ON public.ludo_rooms
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins delete rooms"
ON public.ludo_rooms
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins view players"
ON public.ludo_players
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins insert players"
ON public.ludo_players
WITH CHECK (public.is_admin(auth.uid()));

ALTER POLICY "admins update players"
ON public.ludo_players
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins delete players"
ON public.ludo_players
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins view moves"
ON public.ludo_moves
USING (public.is_admin(auth.uid()));

ALTER POLICY "admins insert moves"
ON public.ludo_moves
WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.ludo_create_room(_max_players integer DEFAULT 2)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room_id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _max_players NOT BETWEEN 2 AND 4 THEN
    RAISE EXCEPTION 'invalid_max_players';
  END IF;

  INSERT INTO public.ludo_rooms (host_id, max_players)
  VALUES (_uid, _max_players)
  RETURNING id INTO _room_id;

  INSERT INTO public.ludo_players (room_id, user_id, seat, color)
  VALUES (_room_id, _uid, 0, 'green');

  RETURN _room_id;
END;
$function$;

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
  _colors text[] := ARRAY['green','red','yellow','blue'];
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
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

  INSERT INTO public.ludo_players (room_id, user_id, seat, color)
  VALUES (_room_id, _uid, _seat, _colors[_seat + 1]);

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
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _players NOT IN (2, 4) THEN
    RAISE EXCEPTION 'invalid_players';
  END IF;

  SELECT r.id, r.max_players INTO _room_id, _max
  FROM public.ludo_rooms r
  WHERE r.status = 'waiting'
    AND r.max_players = _players
    AND NOT EXISTS (
      SELECT 1 FROM public.ludo_players p
      WHERE p.room_id = r.id AND p.user_id = _uid
    )
    AND (SELECT COUNT(*) FROM public.ludo_players p WHERE p.room_id = r.id) < r.max_players
  ORDER BY r.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF _room_id IS NULL THEN
    INSERT INTO public.ludo_rooms (host_id, max_players)
    VALUES (_uid, _players)
    RETURNING id INTO _room_id;

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

CREATE OR REPLACE FUNCTION public.ludo_roll_dice(_room_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _dice int;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND OR _room.status <> 'playing' THEN
    RAISE EXCEPTION 'room_not_playing';
  END IF;

  SELECT * INTO _player FROM public.ludo_players
   WHERE room_id = _room_id AND user_id = _uid;
  IF NOT FOUND OR _player.seat <> _room.current_turn_seat THEN
    RAISE EXCEPTION 'not_your_turn';
  END IF;

  IF _room.last_dice IS NOT NULL THEN
    RAISE EXCEPTION 'dice_pending_move';
  END IF;

  _dice := 1 + floor(random() * 6)::int;

  UPDATE public.ludo_rooms
     SET last_dice = _dice,
         last_roll_at = now()
   WHERE id = _room_id;

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice)
  VALUES (_room_id, _uid, _player.seat, 'roll', _dice);

  RETURN _dice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ludo_skip_turn(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _next_seat int;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND OR _room.status <> 'playing' THEN
    RAISE EXCEPTION 'room_not_playing';
  END IF;

  SELECT * INTO _player FROM public.ludo_players
   WHERE room_id = _room_id AND user_id = _uid;
  IF NOT FOUND OR _player.seat <> _room.current_turn_seat THEN
    RAISE EXCEPTION 'not_your_turn';
  END IF;

  _next_seat := (_room.current_turn_seat + 1) % _room.max_players;

  UPDATE public.ludo_rooms
     SET current_turn_seat = _next_seat,
         last_dice = NULL,
         turn_deadline = now() + interval '30 seconds'
   WHERE id = _room_id;

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action)
  VALUES (_room_id, _uid, _player.seat, 'skip');
END;
$function$;

CREATE OR REPLACE FUNCTION public.ludo_move_token(_room_id uuid, _token_idx integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _tokens jsonb;
  _from int;
  _to int;
  _dice int;
  _start_offset int;
  _next_seat int;
  _captured boolean := false;
  _extra_turn boolean := false;
  _finished boolean := false;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _token_idx NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND OR _room.status <> 'playing' THEN
    RAISE EXCEPTION 'room_not_playing';
  END IF;

  SELECT * INTO _player FROM public.ludo_players
   WHERE room_id = _room_id AND user_id = _uid;
  IF NOT FOUND OR _player.seat <> _room.current_turn_seat THEN
    RAISE EXCEPTION 'not_your_turn';
  END IF;

  IF _room.last_dice IS NULL THEN
    RAISE EXCEPTION 'roll_first';
  END IF;

  _dice := _room.last_dice;
  _tokens := _player.tokens;
  _from := (_tokens ->> _token_idx)::int;
  _start_offset := _player.seat * 13;

  IF _from = -1 THEN
    IF _dice <> 6 THEN
      RAISE EXCEPTION 'need_six_to_leave';
    END IF;
    _to := _start_offset;
    _extra_turn := true;
  ELSIF _from >= 999 THEN
    RAISE EXCEPTION 'token_finished';
  ELSIF _from >= 100 THEN
    _to := _from + _dice;
    IF _to > 105 THEN
      RAISE EXCEPTION 'overshoot';
    END IF;
    IF _to = 105 THEN
      _to := 999;
      _finished := true;
      _extra_turn := true;
    END IF;
  ELSE
    DECLARE
      _rel int;
      _dist_to_entry int;
    BEGIN
      _rel := ((_from - _start_offset + 52) % 52);
      _dist_to_entry := 50 - _rel;
      IF _dice <= _dist_to_entry THEN
        _to := (_from + _dice) % 52;
      ELSE
        _to := 100 + (_dice - _dist_to_entry - 1);
        IF _to > 105 THEN
          RAISE EXCEPTION 'overshoot';
        END IF;
        IF _to = 105 THEN
          _to := 999;
          _finished := true;
          _extra_turn := true;
        END IF;
      END IF;
    END;
    IF _dice = 6 THEN
      _extra_turn := true;
    END IF;
  END IF;

  _tokens := jsonb_set(_tokens, ARRAY[_token_idx::text], to_jsonb(_to));

  UPDATE public.ludo_players
     SET tokens = _tokens,
         finished_count = CASE WHEN _finished THEN finished_count + 1 ELSE finished_count END
   WHERE id = _player.id;

  IF _to BETWEEN 0 AND 51 THEN
    UPDATE public.ludo_players AS opp
       SET tokens = (
         SELECT jsonb_agg(CASE WHEN (t.val)::int = _to THEN to_jsonb(-1) ELSE t.val END)
         FROM jsonb_array_elements(opp.tokens) WITH ORDINALITY AS t(val, ord)
       )
     WHERE opp.room_id = _room_id
       AND opp.user_id <> _uid
       AND opp.tokens @> to_jsonb(_to);
    IF FOUND THEN
      _captured := true;
      _extra_turn := true;
    END IF;
  END IF;

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice, token_idx, from_pos, to_pos)
  VALUES (_room_id, _uid, _player.seat, CASE WHEN _finished THEN 'finish' WHEN _captured THEN 'capture' ELSE 'move' END,
          _dice, _token_idx, _from, _to);

  IF _finished AND (_player.finished_count + 1) >= 4 THEN
    UPDATE public.ludo_rooms
       SET status = 'finished',
           winner_id = _uid,
           finished_at = now(),
           last_dice = NULL,
           turn_deadline = NULL
     WHERE id = _room_id;
    RETURN jsonb_build_object('winner', true, 'to', _to);
  END IF;

  IF _extra_turn THEN
    UPDATE public.ludo_rooms
       SET last_dice = NULL,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  ELSE
    _next_seat := (_room.current_turn_seat + 1) % _room.max_players;
    UPDATE public.ludo_rooms
       SET current_turn_seat = _next_seat,
           last_dice = NULL,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  END IF;

  RETURN jsonb_build_object(
    'to', _to,
    'captured', _captured,
    'extra_turn', _extra_turn,
    'finished', _finished
  );
END;
$function$;