
-- Restore broad SELECT on profiles (game depends on it for player browsing).
-- The critical anti-cheat lock is UPDATE on sensitive columns, which remains REVOKED.
DROP POLICY IF EXISTS profiles_select_self_full ON public.profiles;
CREATE POLICY profiles_select_all_basic ON public.profiles FOR SELECT USING (true);
