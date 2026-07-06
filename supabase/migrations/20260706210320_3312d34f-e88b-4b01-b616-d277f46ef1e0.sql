CREATE OR REPLACE FUNCTION public.ludo_player_has_move(_tokens jsonb, _seat integer, _dice integer)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _idx int;
  _pos int;
  _start_offset int := _seat * 13;
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
      -- finished token: no move
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

GRANT EXECUTE ON FUNCTION public.ludo_player_has_move(jsonb, integer, integer) TO authenticated, service_role;

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

  IF NOT public.ludo_player_has_move(_player.tokens, _player.seat, _dice) THEN
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

  IF _room.last_dice IS NOT NULL AND public.ludo_player_has_move(_player.tokens, _player.seat, _room.last_dice) THEN
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

GRANT EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) TO authenticated, service_role;