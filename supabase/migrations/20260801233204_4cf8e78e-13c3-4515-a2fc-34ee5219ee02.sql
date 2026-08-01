-- Public buckets still serve files by direct public URL, but enumeration/listing
-- of their contents is no longer allowed for anonymous or signed-in clients.
DROP POLICY IF EXISTS "Avatars are publicly viewable" ON storage.objects;
DROP POLICY IF EXISTS "chat_audio_public_read" ON storage.objects;
DROP POLICY IF EXISTS "voice notes public read" ON storage.objects;

-- Owners keep the ability to see/manage their own files.
CREATE POLICY "chat_audio_owner_list"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'chat-audio' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "voice_notes_owner_list"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'voice-notes' AND (auth.uid())::text = (storage.foldername(name))[1]);