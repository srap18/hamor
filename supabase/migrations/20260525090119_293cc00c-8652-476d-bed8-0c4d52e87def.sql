
-- Restore full column SELECT for authenticated; rely on RLS to gate rows.
GRANT SELECT (coins, gems, rubies, xp, protection_until) ON public.profiles TO authenticated;

-- Drop the broad-true policy that lets anyone select any row
DROP POLICY IF EXISTS profiles_select_public_basic ON public.profiles;

-- Public view: only safe columns; security_invoker so RLS doesn't block but
-- we want anyone signed-in to read these basic fields of any user.
DROP VIEW IF EXISTS public.profiles_public CASCADE;
CREATE VIEW public.profiles_public AS
SELECT id, display_name, avatar_emoji, avatar_url, avatar_frame,
       name_frame, selected_bg_id, level, online_at, tribe_id, created_at
FROM public.profiles;
-- Use security_definer view (run as creator) so it bypasses RLS for reads
ALTER VIEW public.profiles_public SET (security_invoker = off);
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Keep owner/admin policy on base table for everything else
-- (already created: profiles_select_self_full)

-- Restore ships SELECT for non-owners but only safe cols
GRANT SELECT (hp, destroyed_at, repair_ends_at) ON public.ships_owned TO authenticated;
-- public view for ships
DROP VIEW IF EXISTS public.ships_public CASCADE;
CREATE VIEW public.ships_public AS
SELECT id, user_id, template_id, catalog_code, at_sea, acquired_at, max_hp
FROM public.ships_owned;
ALTER VIEW public.ships_public SET (security_invoker = off);
GRANT SELECT ON public.ships_public TO anon, authenticated;
