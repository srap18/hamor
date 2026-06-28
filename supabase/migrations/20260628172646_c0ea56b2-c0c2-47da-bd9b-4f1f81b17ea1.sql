
SET LOCAL lock_timeout = '30s';
ALTER POLICY um_update_self ON public.user_market USING (false);
ALTER POLICY um_insert_self ON public.user_market WITH CHECK (false);
