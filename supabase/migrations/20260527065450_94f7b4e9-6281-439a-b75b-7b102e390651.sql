
-- Bucket for transformed voice notes
INSERT INTO storage.buckets (id, name, public) VALUES ('voice-notes', 'voice-notes', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "voice notes public read" ON storage.objects FOR SELECT USING (bucket_id = 'voice-notes');
CREATE POLICY "voice notes auth insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'voice-notes');
CREATE POLICY "voice notes auth delete own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'voice-notes' AND owner = auth.uid());
