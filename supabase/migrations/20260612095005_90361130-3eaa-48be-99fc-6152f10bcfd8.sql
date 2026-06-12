
-- Restrict public-read policies on profiles and ships_owned to authenticated users only.
-- Prevents anonymous scraping (the IDOR finding) while keeping all in-app behavior intact,
-- since every reader in the app is signed in.

DROP POLICY IF EXISTS profiles_select_public_basic ON public.profiles;
CREATE POLICY profiles_select_public_basic ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS ships_select_public_basic ON public.ships_owned;
CREATE POLICY ships_select_public_basic ON public.ships_owned
  FOR SELECT TO authenticated
  USING (true);

-- Remove anon SELECT grants so unauthenticated requests get rejected before RLS.
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.ships_owned FROM anon;
