ALTER TABLE public.user_market DROP CONSTRAINT user_market_level_check;
ALTER TABLE public.user_market ADD CONSTRAINT user_market_level_check CHECK (level >= 1 AND level <= 32);