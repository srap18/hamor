-- Lock down spoofable / unused RPC surfaces found during the deep audit.
-- These functions either accept attacker/recipient identity from the client
-- (allowing spoofing of notifications, banners, and feed entries) or are
-- entirely unused by the client. Internal SECURITY DEFINER callers
-- (start_steal_mission, etc.) bypass these ACLs, so gameplay is unaffected.

-- 1) gift_gold: unused by client (mirror of the gift_gems we removed earlier)
REVOKE EXECUTE ON FUNCTION public.gift_gold(uuid, bigint) FROM anon, authenticated, PUBLIC;

-- 2) notify_steal_started(4-arg overload): lets any signed-in user spoof
--    "X started stealing from you" notifications. The trigger overload
--    (0-arg) is untouched and keeps firing on ships_owned updates.
REVOKE EXECUTE ON FUNCTION public.notify_steal_started(uuid, uuid, text, text) FROM anon, authenticated, PUBLIC;

-- 3) push_global_banner: spoofable global banner (fake attacker/target names).
--    Internal callers (other SECURITY DEFINER funcs) still work.
REVOKE EXECUTE ON FUNCTION public.push_global_banner(text, uuid, text, uuid, text, text, text, text) FROM anon, authenticated, PUBLIC;

-- 4) stamp_global_last_attack: spoofable last-attack feed entry.
REVOKE EXECUTE ON FUNCTION public.stamp_global_last_attack(uuid, text, uuid, text, text) FROM anon, authenticated, PUBLIC;
