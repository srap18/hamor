CREATE OR REPLACE FUNCTION public.ludo_color_start_offset(_color text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _color
    WHEN 'green' THEN 0
    WHEN 'red' THEN 13
    WHEN 'yellow' THEN 26
    WHEN 'blue' THEN 39
    ELSE 0
  END;
$$;

GRANT EXECUTE ON FUNCTION public.ludo_color_start_offset(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ludo_color_start_offset(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ludo_player_has_move(_tokens jsonb, _seat integer, _dice integer, _color text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _idx int;
  _pos int;
  _start_offset int := COALESCE(public.ludo_color_start_offset(_color), _seat * 13);
  _rel int;
  _dist_to_entry int;
  _to int;
BEGIN
  IF _tokens IS NULL OR _dice IS NULL OR _dice NOT BETWEEN 1 AND 6 THEN
    RETURN false;
  END IF;

  FOR _idx IN 0..3 LOOP
    _pos := (_tokens ->> _idx)::int;

    IF _pos = -1 THEN
      IF _dice = 6 THEN
        RETURN true;
      END IF;
    ELSIF _pos >= 999 THEN
      NULL;
    ELSIF _pos >= 100 THEN
      IF _pos + _dice <= 105 THEN
        RETURN true;
      END IF;
    ELSE
      _rel := ((_pos - _start_offset + 52) % 52);
      _dist_to_entry := 50 - _rel;
      IF _dice <= _dist_to_entry THEN
        RETURN true;
      ELSE
        _to := 100 + (_dice - _dist_to_entry - 1);
        IF _to <= 105 THEN
          RETURN true;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ludo_player_has_move(jsonb, integer, integer, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ludo_player_has_move(jsonb, integer, integer, text) FROM PUBLIC, anon;

UPDATE public.ludo_players p
SET color = 'blue'
FROM public.ludo_rooms r
WHERE r.id = p.room_id
  AND r.max_players = 2
  AND p.seat = 1
  AND p.color <> 'blue'
  AND NOT EXISTS (
    SELECT 1 FROM public.ludo_players b
    WHERE b.room_id = p.room_id AND b.color = 'blue'
  );

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
    WHEN _room.max_players = 2 AND _seat = 1 THEN 'blue'
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

  SELECT p.room_id INTO _room_id
  FROM public.ludo_players p
  JOIN public.ludo_rooms r ON r.id = p.room_id
  WHERE p.user_id = _uid AND r.status IN ('waiting','playing')
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF _room_id IS NOT NULL THEN
    RETURN _room_id;
  END IF;

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
  _color := CASE
    WHEN _max = 2 AND _seat = 1 THEN 'blue'
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
$function$;

CREATE OR REPLACE FUNCTION public.ludo_roll_dice(_room_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _dice int;
  _next_seat int;
BEGIN
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
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

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice)
  VALUES (_room_id, _uid, _player.seat, 'roll', _dice);

  IF NOT public.ludo_player_has_move(_player.tokens, _player.seat, _dice, _player.color) THEN
    _next_seat := (_room.current_turn_seat + 1) % _room.max_players;
    UPDATE public.ludo_rooms
       SET current_turn_seat = _next_seat,
           last_dice = NULL,
           last_roll_at = now(),
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  ELSE
    UPDATE public.ludo_rooms
       SET last_dice = _dice,
           last_roll_at = now()
     WHERE id = _room_id;
  END IF;

  RETURN _dice;
END;
$$;

CREATE OR REPLACE FUNCTION public.ludo_skip_turn(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _next_seat int;
BEGIN
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
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

  IF _room.last_dice IS NOT NULL AND public.ludo_player_has_move(_player.tokens, _player.seat, _room.last_dice, _player.color) THEN
    RAISE EXCEPTION 'move_available';
  END IF;

  _next_seat := (_room.current_turn_seat + 1) % _room.max_players;

  UPDATE public.ludo_rooms
     SET current_turn_seat = _next_seat,
         last_dice = NULL,
         turn_deadline = now() + interval '30 seconds'
   WHERE id = _room_id;

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice)
  VALUES (_room_id, _uid, _player.seat, 'skip', _room.last_dice);
END;
$$;

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
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
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
  _start_offset := public.ludo_color_start_offset(_player.color);

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

REVOKE EXECUTE ON FUNCTION public.ludo_join_room(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_quick_match(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ludo_join_room(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_quick_match(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) TO authenticated, service_role;