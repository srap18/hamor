-- Internal steal helpers must never be callable by players (bypasses all guards)
REVOKE ALL ON FUNCTION public.start_steal_mission_impl(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.steal_fish(uuid, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._settle_steal_mission(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._steal_log_write(uuid, uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._steal_log_settle(uuid, uuid, bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.steal_guard_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.steal_link_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_steal_mission_impl(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.steal_fish(uuid, integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._settle_steal_mission(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._steal_log_write(uuid, uuid, uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._steal_log_settle(uuid, uuid, bigint, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.steal_guard_reason(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.steal_link_reason(uuid, uuid) TO service_role;

-- Public-facing steal RPCs: signed-in players only
REVOKE ALL ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_steal_mission(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_steal_mission(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.steal_mission_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_steal_log(integer, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_steal_alerts(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_steal_mission(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.steal_mission_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_steal_log(integer, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_steal_alerts(integer) TO authenticated, service_role;