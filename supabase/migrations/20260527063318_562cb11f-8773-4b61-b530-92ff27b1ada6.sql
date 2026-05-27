
-- Voice rooms (Clubhouse-style audio rooms)
CREATE TABLE public.voice_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  max_users INTEGER NOT NULL DEFAULT 8,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_rooms TO authenticated;
GRANT ALL ON public.voice_rooms TO service_role;

ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY vr_select_all ON public.voice_rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY vr_insert_own ON public.voice_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY vr_update_owner_or_admin ON public.voice_rooms FOR UPDATE TO authenticated USING (auth.uid() = created_by OR is_admin(auth.uid()));
CREATE POLICY vr_delete_owner_or_admin ON public.voice_rooms FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin(auth.uid()));

-- Participants
CREATE TABLE public.voice_room_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  is_speaker BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_room_participants TO authenticated;
GRANT ALL ON public.voice_room_participants TO service_role;

ALTER TABLE public.voice_room_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY vrp_select_all ON public.voice_room_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY vrp_insert_own ON public.voice_room_participants FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY vrp_update_own ON public.voice_room_participants FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY vrp_delete_own_or_room_owner ON public.voice_room_participants FOR DELETE TO authenticated USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.voice_rooms r WHERE r.id = room_id AND r.created_by = auth.uid())
  OR is_admin(auth.uid())
);

CREATE INDEX idx_vrp_room ON public.voice_room_participants(room_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_participants;
