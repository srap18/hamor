
-- Persistent chat messages tied to a voice room (deleted with the room)
CREATE TABLE public.voice_room_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  text TEXT,
  voice_url TEXT,
  preset TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vrm_room ON public.voice_room_messages(room_id, created_at);

GRANT SELECT, INSERT ON public.voice_room_messages TO authenticated;
GRANT ALL ON public.voice_room_messages TO service_role;

ALTER TABLE public.voice_room_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY vrm_select_all ON public.voice_room_messages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY vrm_insert_own ON public.voice_room_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY vrm_admin_delete ON public.voice_room_messages
  FOR DELETE TO authenticated USING (is_admin(auth.uid()));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_messages;
ALTER TABLE public.voice_room_messages REPLICA IDENTITY FULL;

-- Track when a room became empty (no participants) for auto-cleanup
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS empty_since TIMESTAMPTZ DEFAULT now();

-- Trigger: keep empty_since in sync with participants count
CREATE OR REPLACE FUNCTION public._voice_room_touch_empty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _rid UUID; _cnt INT;
BEGIN
  _rid := COALESCE(NEW.room_id, OLD.room_id);
  SELECT COUNT(*) INTO _cnt FROM public.voice_room_participants WHERE room_id = _rid;
  IF _cnt = 0 THEN
    UPDATE public.voice_rooms SET empty_since = now() WHERE id = _rid;
  ELSE
    UPDATE public.voice_rooms SET empty_since = NULL WHERE id = _rid AND empty_since IS NOT NULL;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_vrp_touch_empty_ins ON public.voice_room_participants;
DROP TRIGGER IF EXISTS trg_vrp_touch_empty_del ON public.voice_room_participants;

CREATE TRIGGER trg_vrp_touch_empty_ins
AFTER INSERT ON public.voice_room_participants
FOR EACH ROW EXECUTE FUNCTION public._voice_room_touch_empty();

CREATE TRIGGER trg_vrp_touch_empty_del
AFTER DELETE ON public.voice_room_participants
FOR EACH ROW EXECUTE FUNCTION public._voice_room_touch_empty();

-- Cleanup function: delete rooms empty for >= 10 minutes (cascades messages)
CREATE OR REPLACE FUNCTION public.cleanup_empty_voice_rooms()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n INT;
BEGIN
  DELETE FROM public.voice_rooms
  WHERE empty_since IS NOT NULL
    AND empty_since < now() - INTERVAL '10 minutes';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- Schedule cleanup every minute
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  PERFORM cron.unschedule('cleanup-empty-voice-rooms');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('cleanup-empty-voice-rooms', '* * * * *', $$SELECT public.cleanup_empty_voice_rooms();$$);

-- Initialize empty_since for existing empty rooms
UPDATE public.voice_rooms r SET empty_since = now()
WHERE NOT EXISTS (SELECT 1 FROM public.voice_room_participants p WHERE p.room_id = r.id)
  AND empty_since IS NULL;
UPDATE public.voice_rooms r SET empty_since = NULL
WHERE EXISTS (SELECT 1 FROM public.voice_room_participants p WHERE p.room_id = r.id)
  AND empty_since IS NOT NULL;
