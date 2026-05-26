-- Restore broad SELECT on profiles to fix leaderboard and player harbors
DROP POLICY IF EXISTS profiles_select_own_full ON public.profiles;

CREATE POLICY profiles_select_all
ON public.profiles
FOR SELECT
USING (true);