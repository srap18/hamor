
-- =========================================================
-- Ludo: forfeit + bot auto-play + resume active room
-- =========================================================

-- Return the (waiting or playing) room the user is currently in, if any.
CREATE OR REPLACE FUNCTION public.ludo_active_room_for(_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id
  FROM public.ludo_rooms r
  JOIN public.ludo_players p ON p.room_id = r.id
  WHERE p.user_id = _uid
    AND r.status IN ('waiting','playing')
  ORDER BY (r.status = 'playing') DESC, r.updated_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.ludo_active_room_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludo_active_room_for(uuid) TO authenticated, service_role;

-- =========================================================
-- Forfeit: leaving player quits. Opponent(s) win immediately.
-- Waiting room = deleted. Playing room = winner set + row deleted.
-- =========================================================
CREATE OR REPLACE FUNCTION public.ludo_forfeit(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _me public.ludo_players%ROWTYPE;
  _remaining_count int;
  _winner_uid uuid;
  _next_seat int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO _me FROM public.ludo_players
   WHERE room_id = _room_id AND user_id = _uid;

  -- Waiting room: just remove the player; trigger deletes if empty.
  IF _room.status = 'waiting' THEN
    IF FOUND THEN
      DELETE FROM public.ludo_players WHERE id = _me.id;
    END IF;
    -- Ensure host-leaving kills the whole waiting room.
    IF _room.host_id = _uid THEN
      DELETE FROM public.ludo_rooms WHERE id = _room_id;
    END IF;
    RETURN;
  END IF;

  -- Playing room: remove leaver, then decide winner / next state.
  IF FOUND THEN
    DELETE FROM public.ludo_players WHERE id = _me.id;
  END IF;

  SELECT count(*) INTO _remaining_count
    FROM public.ludo_players WHERE room_id = _room_id;

  IF _remaining_count <= 1 THEN
    SELECT user_id INTO _winner_uid
      FROM public.ludo_players WHERE room_id = _room_id LIMIT 1;

    UPDATE public.ludo_rooms
       SET status = 'finished',
           winner_id = _winner_uid,
           finished_at = now(),
           last_dice = NULL,
           turn_deadline = NULL
     WHERE id = _room_id;

    -- Hard-delete instantly so the room doesn't linger.
    DELETE FROM public.ludo_rooms WHERE id = _room_id;
  ELSE
    -- 4-player game continues without the leaver; advance turn if needed.
    IF _me.seat = _room.current_turn_seat THEN
      _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
      UPDATE public.ludo_rooms
         SET current_turn_seat = _next_seat,
             last_dice = NULL,
             turn_deadline = now() + interval '30 seconds'
       WHERE id = _room_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ludo_forfeit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludo_forfeit(uuid) TO authenticated, service_role;

-- Alias used by the client.
CREATE OR REPLACE FUNCTION public.ludo_leave_room(_room_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ludo_forfeit(_room_id);
$$;

REVOKE ALL ON FUNCTION public.ludo_leave_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludo_leave_room(uuid) TO authenticated, service_role;

-- =========================================================
-- Bot auto-play: plays for the CURRENT SEAT.
-- Any authenticated player in the room can trigger it once the
-- turn_deadline has passed. Rolls when no dice is pending, else
-- picks a legal move (prefers capture > finish > leave-home > home-stretch > farthest).
-- =========================================================
CREATE OR REPLACE FUNCTION public.ludo_bot_play(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _tokens jsonb;
  _dice int;
  _next_seat int;
  _start_offset int;
  _idx int;
  _pos int;
  _from int;
  _to int;
  _best_idx int := -1;
  _best_to int;
  _best_priority int := -1;
  _priority int;
  _rel int;
  _dist int;
  _cand_to int;
  _cand_valid boolean;
  _captured boolean := false;
  _extra_turn boolean := false;
  _finished boolean := false;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND OR _room.status <> 'playing' THEN
    RETURN;
  END IF;

  -- Only run once the deadline has clearly passed (give ~2s slack).
  IF _room.turn_deadline IS NULL OR _room.turn_deadline > now() - interval '1 second' THEN
    RETURN;
  END IF;

  -- Caller must be in the room.
  IF NOT EXISTS (
    SELECT 1 FROM public.ludo_players WHERE room_id = _room_id AND user_id = _caller
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO _player FROM public.ludo_players
   WHERE room_id = _room_id AND seat = _room.current_turn_seat;
  IF NOT FOUND THEN
    _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
    UPDATE public.ludo_rooms
       SET current_turn_seat = _next_seat,
           last_dice = NULL,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
    RETURN;
  END IF;

  _start_offset := public.ludo_color_start_offset(_player.color);

  -- --- Phase 1: roll if no dice pending ---
  IF _room.last_dice IS NULL THEN
    _dice := 1 + floor(random() * 6)::int;

    INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice)
    VALUES (_room_id, _player.user_id, _player.seat, 'roll', _dice);

    IF NOT public.ludo_player_has_move(_player.tokens, _player.seat, _dice, _player.color) THEN
      _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
      UPDATE public.ludo_rooms
         SET current_turn_seat = _next_seat,
             last_dice = NULL,
             last_roll_at = now(),
             turn_deadline = now() + interval '30 seconds'
       WHERE id = _room_id;
    ELSE
      UPDATE public.ludo_rooms
         SET last_dice = _dice,
             last_roll_at = now(),
             turn_deadline = now() + interval '30 seconds'
       WHERE id = _room_id;
    END IF;
    RETURN;
  END IF;

  -- --- Phase 2: dice pending, pick a move ---
  _dice := _room.last_dice;
  _tokens := _player.tokens;

  FOR _idx IN 0..3 LOOP
    _pos := (_tokens ->> _idx)::int;
    _cand_valid := false;
    _priority := -1;

    IF _pos = -1 THEN
      IF _dice = 6 THEN
        _cand_to := _start_offset;
        _cand_valid := true;
        _priority := 3; -- leave home
      END IF;
    ELSIF _pos >= 999 THEN
      NULL;
    ELSIF _pos >= 100 THEN
      IF _pos + _dice <= 105 THEN
        _cand_to := _pos + _dice;
        IF _cand_to = 105 THEN _cand_to := 999; END IF;
        _cand_valid := true;
        _priority := CASE WHEN _cand_to = 999 THEN 4 ELSE 2 END; -- finish > home-stretch
      END IF;
    ELSE
      _rel := ((_pos - _start_offset + 52) % 52);
      _dist := 50 - _rel;
      IF _dice <= _dist THEN
        _cand_to := (_pos + _dice) % 52;
        _cand_valid := true;
        _priority := 1;
        -- capture bonus
        IF _cand_to BETWEEN 0 AND 51
           AND NOT (_cand_to = ANY (ARRAY[0,8,13,21,26,34,39,47]))
           AND EXISTS (
             SELECT 1 FROM public.ludo_players opp
             WHERE opp.room_id = _room_id
               AND opp.user_id <> _player.user_id
               AND opp.tokens @> to_jsonb(_cand_to)
           ) THEN
          _priority := 5; -- capture is best
        END IF;
      ELSE
        _cand_to := 100 + (_dice - _dist - 1);
        IF _cand_to <= 105 THEN
          IF _cand_to = 105 THEN _cand_to := 999; END IF;
          _cand_valid := true;
          _priority := CASE WHEN _cand_to = 999 THEN 4 ELSE 2 END;
        END IF;
      END IF;
    END IF;

    IF _cand_valid AND _priority > _best_priority THEN
      _best_priority := _priority;
      _best_idx := _idx;
      _best_to := _cand_to;
    END IF;
  END LOOP;

  IF _best_idx < 0 THEN
    -- No legal move (shouldn't normally happen, but skip safely).
    _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
    UPDATE public.ludo_rooms
       SET current_turn_seat = _next_seat,
           last_dice = NULL,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
    RETURN;
  END IF;

  _from := (_tokens ->> _best_idx)::int;
  _to := _best_to;
  IF _from = -1 THEN
    _extra_turn := true;
  ELSIF _to = 999 THEN
    _finished := true;
    _extra_turn := true;
  ELSIF _dice = 6 THEN
    _extra_turn := true;
  END IF;

  _tokens := jsonb_set(_tokens, ARRAY[_best_idx::text], to_jsonb(_to));

  UPDATE public.ludo_players
     SET tokens = _tokens,
         finished_count = CASE WHEN _finished THEN finished_count + 1 ELSE finished_count END
   WHERE id = _player.id;

  -- Capture check
  IF _to BETWEEN 0 AND 51 THEN
    UPDATE public.ludo_players AS opp
       SET tokens = (
         SELECT jsonb_agg(CASE WHEN (t.val)::int = _to THEN to_jsonb(-1) ELSE t.val END)
         FROM jsonb_array_elements(opp.tokens) WITH ORDINALITY AS t(val, ord)
       )
     WHERE opp.room_id = _room_id
       AND opp.user_id <> _player.user_id
       AND opp.tokens @> to_jsonb(_to)
       AND NOT (_to = ANY (ARRAY[0,8,13,21,26,34,39,47]));
    IF FOUND THEN
      _captured := true;
      _extra_turn := true;
    END IF;
  END IF;

  INSERT INTO public.ludo_moves (room_id, player_id, seat, action, dice, token_idx, from_pos, to_pos)
  VALUES (_room_id, _player.user_id, _player.seat,
          CASE WHEN _finished THEN 'finish' WHEN _captured THEN 'capture' ELSE 'move' END,
          _dice, _best_idx, _from, _to);

  -- Winner?
  IF _finished AND (_player.finished_count + 1) >= 4 THEN
    UPDATE public.ludo_rooms
       SET status = 'finished',
           winner_id = _player.user_id,
           finished_at = now(),
           last_dice = NULL,
           turn_deadline = NULL
     WHERE id = _room_id;
    RETURN;
  END IF;

  IF _extra_turn THEN
    UPDATE public.ludo_rooms
       SET last_dice = NULL,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  ELSE
    _next_seat := public.ludo_next_active_seat(_room_id, _room.current_turn_seat, _room.max_players);
    UPDATE public.ludo_rooms
       SET current_turn_seat = _next_seat,
           last_dice = NULL,
           turn_deadline = now() + interval '30 seconds'
     WHERE id = _room_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ludo_bot_play(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludo_bot_play(uuid) TO authenticated, service_role;
