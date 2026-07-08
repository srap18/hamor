
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
  _sixes int;
  _start_offset int;
  _pre_home_cell int;
  _can_win_now boolean := false;
  _tok int;
BEGIN
  IF _uid IS NULL OR NOT (public.is_admin(_uid) OR public.has_role(_uid, 'moderator')) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.ludo_cleanup_stale_rooms();

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
  _sixes := COALESCE(_room.consecutive_sixes, 0);

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice)
  VALUES (_room_id, _uid, _player.seat, 'roll', _dice);

  -- Rule: three 6s in a row -> forfeit the turn, UNLESS this very 6 would
  -- finish the player's last remaining token (winning move takes precedence).
  IF _dice = 6 AND _sixes >= 2 THEN
    _can_win_now := false;
    IF _player.finished_count = 3 THEN
      _start_offset := public.ludo_color_start_offset(_player.color);
      _pre_home_cell := (_start_offset + 50) % 52;  -- cell where dice=6 -> 105 -> 999
      FOR _tok IN
        SELECT (value)::int FROM jsonb_array_elements_text(_player.tokens)
      LOOP
        IF _tok = _pre_home_cell THEN
          _can_win_now := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF NOT _can_win_now THEN
      _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
      UPDATE public.ludo_rooms
         SET current_turn_seat = _next_seat,
             last_dice = NULL,
             last_roll_at = now(),
             consecutive_sixes = 0,
             turn_deadline = now() + interval '30 seconds'
       WHERE id = _room_id;
      INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice)
      VALUES (_room_id, _uid, _player.seat, 'three_sixes', _dice);
      RETURN _dice;
    END IF;
    -- Winning move allowed: fall through and set last_dice so player can move.
  END IF;

  IF NOT public.ludo_player_has_move(_player.tokens, _player.seat, _dice, _player.color) THEN
    _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
    UPDATE public.ludo_rooms
       SET current_turn_seat = _next_seat,
           last_dice = NULL,
           last_roll_at = now(),
           consecutive_sixes = 0,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  ELSE
    UPDATE public.ludo_rooms
       SET last_dice = _dice,
           last_roll_at = now(),
           consecutive_sixes = CASE WHEN _dice = 6 THEN _sixes + 1 ELSE 0 END,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  END IF;

  RETURN _dice;
END;
$$;
