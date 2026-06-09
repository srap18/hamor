DROP FUNCTION IF EXISTS public.admin_delete_voice_room(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_idle_voice_rooms() CASCADE;
DROP TABLE IF EXISTS public.voice_room_messages CASCADE;
DROP TABLE IF EXISTS public.voice_room_participants CASCADE;
DROP TABLE IF EXISTS public.voice_rooms CASCADE;