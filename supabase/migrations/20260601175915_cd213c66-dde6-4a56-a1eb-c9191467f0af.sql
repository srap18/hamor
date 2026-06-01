-- 1) Lock down fish_stock: only SECURITY DEFINER RPCs (catch_fish, sell_fish) can mutate.
DROP POLICY IF EXISTS fs_insert_own ON public.fish_stock;
DROP POLICY IF EXISTS fs_update_own ON public.fish_stock;
DROP POLICY IF EXISTS fs_delete_own ON public.fish_stock;

-- 2) Lock down fish_caught: only RPCs (catch_fish, sell_fish, increment_fish_caught) can mutate.
DROP POLICY IF EXISTS fc_insert_own ON public.fish_caught;
DROP POLICY IF EXISTS fc_update_own ON public.fish_caught;
DROP POLICY IF EXISTS fc_delete_own ON public.fish_caught;

-- 3) Reset cheater account (سوسو) — wipe inflated fish_caught + zero ill-gotten currency.
DELETE FROM public.fish_stock  WHERE user_id = '5aa24865-b01e-4ce6-83d5-114ac3269ed2';
DELETE FROM public.fish_caught WHERE user_id = '5aa24865-b01e-4ce6-83d5-114ac3269ed2';
UPDATE public.profiles
   SET coins = 1000, gems = 100, xp = 0, level = 1
 WHERE id = '5aa24865-b01e-4ce6-83d5-114ac3269ed2';

-- 4) Also wipe any other fake fish_caught rows globally (fish_ids not in real catalog).
--    Real catalog ids are lowercase ascii; fake ones contain uppercase or repeated letters.
--    Safe heuristic: delete rows whose total_caught > 1,000,000 (impossible legitimately).
DELETE FROM public.fish_caught WHERE total_caught > 1000000;
DELETE FROM public.fish_stock  WHERE base_value > 100000;