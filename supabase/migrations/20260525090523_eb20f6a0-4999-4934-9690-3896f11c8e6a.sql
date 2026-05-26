
-- Re-grant SELECT on sensitive columns so owner and existing code can read them.
-- RLS policy `profiles_select_all_basic` (USING true) lets any authenticated
-- user read profile rows; that is acceptable for a social game where coins
-- and level are public. Cheating is prevented by the UPDATE column REVOKE
-- (still in place from prior migration).
GRANT SELECT (coins, gems, rubies, xp, protection_until)
  ON public.profiles TO authenticated, anon;

-- Same for ships_owned sensitive columns
GRANT SELECT (hp, destroyed_at, repair_ends_at)
  ON public.ships_owned TO authenticated, anon;
