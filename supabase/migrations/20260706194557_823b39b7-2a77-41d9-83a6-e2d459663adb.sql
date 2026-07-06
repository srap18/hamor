
-- ============================================================
-- LUDO GAME SYSTEM (Admin-only during development)
-- ============================================================

-- ROOMS
CREATE TABLE public.ludo_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','playing','finished','cancelled')),
  max_players int NOT NULL DEFAULT 2 CHECK (max_players BETWEEN 2 AND 4),
  current_turn_seat int NOT NULL DEFAULT 0,
  last_dice int,
  last_roll_at timestamptz,
  winner_id uuid REFERENCES auth.users(id),
  turn_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ludo_rooms TO authenticated;
GRANT ALL ON public.ludo_rooms TO service_role;

ALTER TABLE public.ludo_rooms ENABLE ROW LEVEL SECURITY;

-- Only admins can access (feature flag - hidden from players)
CREATE POLICY "admins view rooms" ON public.ludo_rooms FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert rooms" ON public.ludo_rooms FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update rooms" ON public.ludo_rooms FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete rooms" ON public.ludo_rooms FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- PLAYERS
CREATE TABLE public.ludo_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.ludo_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seat int NOT NULL CHECK (seat BETWEEN 0 AND 3),
  color text NOT NULL CHECK (color IN ('green','red','yellow','blue')),
  -- 4 tokens, each position: -1=home, 0..51=board path, 100..105=final stretch, 999=finished
  tokens jsonb NOT NULL DEFAULT '[-1,-1,-1,-1]'::jsonb,
  finished_count int NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id, seat),
  UNIQUE(room_id, user_id),
  UNIQUE(room_id, color)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ludo_players TO authenticated;
GRANT ALL ON public.ludo_players TO service_role;

ALTER TABLE public.ludo_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins view players" ON public.ludo_players FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert players" ON public.ludo_players FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update players" ON public.ludo_players FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete players" ON public.ludo_players FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- MOVES (audit + anti-cheat log)
CREATE TABLE public.ludo_moves (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.ludo_rooms(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seat int NOT NULL,
  action text NOT NULL CHECK (action IN ('roll','move','capture','finish','skip')),
  dice int,
  token_idx int,
  from_pos int,
  to_pos int,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ludo_moves TO authenticated;
GRANT ALL ON public.ludo_moves TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ludo_moves_id_seq TO authenticated;

ALTER TABLE public.ludo_moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins view moves" ON public.ludo_moves FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert moves" ON public.ludo_moves FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX idx_ludo_rooms_status ON public.ludo_rooms(status) WHERE status IN ('waiting','playing');
CREATE INDEX idx_ludo_players_room ON public.ludo_players(room_id);
CREATE INDEX idx_ludo_moves_room ON public.ludo_moves(room_id, id DESC);

-- Updated-at trigger
CREATE TRIGGER ludo_rooms_updated_at
  BEFORE UPDATE ON public.ludo_rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable Realtime
ALTER TABLE public.ludo_rooms REPLICA IDENTITY FULL;
ALTER TABLE public.ludo_players REPLICA IDENTITY FULL;
ALTER TABLE public.ludo_moves REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ludo_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ludo_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ludo_moves;

-- ============================================================
-- SERVER RPCs (anti-cheat: server owns dice + move validation)
-- ============================================================

-- Create a new room (admin only)
CREATE OR REPLACE FUNCTION public.ludo_create_room(_max_players int DEFAULT 2)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room_id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _max_players NOT BETWEEN 2 AND 4 THEN
    RAISE EXCEPTION 'invalid_max_players';
  END IF;

  INSERT INTO public.ludo_rooms (host_id, max_players)
  VALUES (_uid, _max_players)
  RETURNING id INTO _room_id;

  -- Host auto-joins as green (seat 0)
  INSERT INTO public.ludo_players (room_id, user_id, seat, color)
  VALUES (_room_id, _uid, 0, 'green');

  RETURN _room_id;
END;
$$;

-- Join a waiting room
CREATE OR REPLACE FUNCTION public.ludo_join_room(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _count int;
  _seat int;
  _colors text[] := ARRAY['green','red','yellow','blue'];
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _room FROM public.ludo_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND OR _room.status <> 'waiting' THEN
    RAISE EXCEPTION 'room_unavailable';
  END IF;

  -- Already joined?
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

  -- Auto-start when full
  IF _count + 1 >= _room.max_players THEN
    UPDATE public.ludo_rooms
       SET status = 'playing',
           started_at = now(),
           turn_deadline = now() + interval '30 seconds',
           current_turn_seat = 0
     WHERE id = _room_id;
  END IF;
END;
$$;

-- Roll the dice (server-generated)
CREATE OR REPLACE FUNCTION public.ludo_roll_dice(_room_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _dice int;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
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

  -- Prevent double-roll: last_dice must be consumed (null) before next roll
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
$$;

-- Move a token (server validates legality)
CREATE OR REPLACE FUNCTION public.ludo_move_token(_room_id uuid, _token_idx int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.ludo_rooms%ROWTYPE;
  _player public.ludo_players%ROWTYPE;
  _tokens jsonb;
  _from int;
  _to int;
  _dice int;
  _start_offset int;  -- board entry per color
  _next_seat int;
  _captured boolean := false;
  _extra_turn boolean := false;
  _finished boolean := false;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
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

  -- Board entry per seat (52-cell loop)
  _start_offset := _player.seat * 13;

  -- Token in home → needs 6 to leave
  IF _from = -1 THEN
    IF _dice <> 6 THEN
      RAISE EXCEPTION 'need_six_to_leave';
    END IF;
    _to := _start_offset;
    _extra_turn := true; -- rolling 6 grants another turn
  ELSIF _from >= 999 THEN
    RAISE EXCEPTION 'token_finished';
  ELSIF _from >= 100 THEN
    -- On final stretch (100..105); 105 = final square
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
    -- On main loop (0..51). Compute distance to own home-entry (start_offset + 50)
    DECLARE
      _rel int;
      _dist_to_entry int;
    BEGIN
      _rel := ((_from - _start_offset + 52) % 52);
      _dist_to_entry := 50 - _rel; -- cell before entering final stretch
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

  -- Apply move
  _tokens := jsonb_set(_tokens, ARRAY[_token_idx::text], to_jsonb(_to));

  UPDATE public.ludo_players
     SET tokens = _tokens,
         finished_count = CASE WHEN _finished THEN finished_count + 1 ELSE finished_count END
   WHERE id = _player.id;

  -- Capture: if landing on main-loop cell where an opponent single token sits (not safe cell), send home
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

  -- Win check
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

  -- Advance turn (unless extra)
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
$$;

-- Skip turn (used when no valid move possible, e.g. rolled non-6 with all tokens home)
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
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.ludo_create_room(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ludo_join_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ludo_move_token(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) TO authenticated;
