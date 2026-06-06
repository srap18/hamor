
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Cleanup function: voice recordings older than 30 min + empty voice rooms
CREATE OR REPLACE FUNCTION public.cleanup_voice_artifacts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  r record;
  obj_path text;
BEGIN
  -- 1) Delete voice_room_messages with audio older than 30 minutes (and their storage files)
  FOR r IN
    SELECT id, voice_url
    FROM public.voice_room_messages
    WHERE voice_url IS NOT NULL
      AND created_at < now() - interval '30 minutes'
  LOOP
    -- Extract object path after '/voice-notes/'
    obj_path := NULLIF(split_part(r.voice_url, '/voice-notes/', 2), '');
    IF obj_path IS NOT NULL THEN
      DELETE FROM storage.objects WHERE bucket_id = 'voice-notes' AND name = obj_path;
    END IF;
    DELETE FROM public.voice_room_messages WHERE id = r.id;
  END LOOP;

  -- 2) Delete chat messages with audio older than 30 minutes (and their storage files)
  FOR r IN
    SELECT id, audio_url, body
    FROM public.messages
    WHERE audio_url IS NOT NULL
      AND created_at < now() - interval '30 minutes'
  LOOP
    obj_path := NULLIF(split_part(r.audio_url, '/chat-audio/', 2), '');
    IF obj_path IS NOT NULL THEN
      DELETE FROM storage.objects WHERE bucket_id = 'chat-audio' AND name = obj_path;
    END IF;
    -- If message has text body, just strip the audio; otherwise delete the row
    IF length(coalesce(r.body, '')) >= 1 THEN
      UPDATE public.messages SET audio_url = NULL, audio_duration_ms = NULL WHERE id = r.id;
    ELSE
      DELETE FROM public.messages WHERE id = r.id;
    END IF;
  END LOOP;

  -- 3) Delete voice rooms that have been empty for 2+ minutes
  DELETE FROM public.voice_rooms vr
  WHERE NOT EXISTS (SELECT 1 FROM public.voice_room_participants p WHERE p.room_id = vr.id)
    AND vr.empty_since IS NOT NULL
    AND vr.empty_since < now() - interval '2 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_voice_artifacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_voice_artifacts() TO service_role;

-- Schedule: every 2 minutes
SELECT cron.unschedule('cleanup-voice-artifacts') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-voice-artifacts'
);

SELECT cron.schedule(
  'cleanup-voice-artifacts',
  '*/2 * * * *',
  $$ SELECT public.cleanup_voice_artifacts(); $$
);
