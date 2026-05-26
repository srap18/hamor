
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_duration_ms int;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_body_check
  CHECK (length(body) <= 500 AND (length(body) >= 1 OR audio_url IS NOT NULL));

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-audio', 'chat-audio', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_audio_public_read" ON storage.objects;
CREATE POLICY "chat_audio_public_read" ON storage.objects FOR SELECT
USING (bucket_id = 'chat-audio');

DROP POLICY IF EXISTS "chat_audio_user_insert" ON storage.objects;
CREATE POLICY "chat_audio_user_insert" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "chat_audio_user_delete" ON storage.objects;
CREATE POLICY "chat_audio_user_delete" ON storage.objects FOR DELETE
USING (bucket_id = 'chat-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
