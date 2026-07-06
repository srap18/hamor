REVOKE EXECUTE ON FUNCTION public.ludo_player_has_move(jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ludo_player_has_move(jsonb, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_roll_dice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_skip_turn(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ludo_move_token(uuid, integer) TO authenticated, service_role;