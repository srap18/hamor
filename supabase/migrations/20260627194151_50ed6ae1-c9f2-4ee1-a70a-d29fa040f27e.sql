
DROP FUNCTION IF EXISTS public.vr_take_seat(uuid, int) CASCADE;
DROP FUNCTION IF EXISTS public.vr_leave_seat(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_heartbeat(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_join_room(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.vr_create_room(text, boolean, text, int, text) CASCADE;
DROP FUNCTION IF EXISTS public.vr_create_room CASCADE;
DROP FUNCTION IF EXISTS public.vr_leave_room(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_request_mic(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_resolve_request(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.vr_mod_action CASCADE;
DROP FUNCTION IF EXISTS public.vr_admin_creation_ban(uuid, text, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.vr_admin_creation_unban(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_is_admin(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_is_owner(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_is_mod_or_owner(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.vr_is_banned(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public._voice_room_touch_empty() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_empty_voice_rooms() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_idle_voice_rooms() CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_voice_room(uuid) CASCADE;

DROP TABLE IF EXISTS public.voice_room_global_mutes CASCADE;
DROP TABLE IF EXISTS public.voice_room_creation_bans CASCADE;
DROP TABLE IF EXISTS public.voice_room_logs CASCADE;
DROP TABLE IF EXISTS public.voice_room_reports CASCADE;
DROP TABLE IF EXISTS public.voice_room_bans CASCADE;
DROP TABLE IF EXISTS public.voice_room_messages CASCADE;
DROP TABLE IF EXISTS public.voice_room_requests CASCADE;
DROP TABLE IF EXISTS public.voice_room_members CASCADE;
DROP TABLE IF EXISTS public.voice_room_participants CASCADE;
DROP TABLE IF EXISTS public.voice_rooms CASCADE;

DROP TYPE IF EXISTS public.voice_room_role CASCADE;
DROP TYPE IF EXISTS public.voice_room_req_status CASCADE;
DROP TYPE IF EXISTS public.voice_room_report_target CASCADE;
