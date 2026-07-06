-- Restrict Ludo RPC functions to signed-in users only.
-- Each function still performs role checks internally for admin/moderator access.

REVOKE EXECUTE ON FUNCTION public.ludo_cleanup_empty_room() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_cleanup_stale_rooms() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_create_room(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_join_room(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_quick_match(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ludo_cleanup_empty_room() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_cleanup_stale_rooms() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_create_room(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_join_room(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_quick_match(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) TO authenticated, service_role;