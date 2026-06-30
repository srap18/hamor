-- 🔴 CRITICAL: drop economy vulnerabilities
DROP FUNCTION IF EXISTS public.buy_ship(integer);
DROP FUNCTION IF EXISTS public.deduct_gems_for_voice_change(uuid, integer);