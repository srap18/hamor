
SET LOCAL lock_timeout = '15s';
REVOKE INSERT, UPDATE ON public.inventory             FROM authenticated;
REVOKE INSERT, UPDATE ON public.ships_owned           FROM authenticated;
REVOKE INSERT, UPDATE ON public.dragons               FROM authenticated;
REVOKE INSERT, UPDATE ON public.dragon_equipment      FROM authenticated;
REVOKE INSERT, UPDATE ON public.user_fish_market      FROM authenticated;
REVOKE INSERT, UPDATE ON public.daily_login_streaks   FROM authenticated;
REVOKE INSERT, UPDATE ON public.user_market_state     FROM authenticated;
REVOKE INSERT, UPDATE ON public.user_market           FROM authenticated;
REVOKE         UPDATE ON public.tribes                FROM authenticated;
