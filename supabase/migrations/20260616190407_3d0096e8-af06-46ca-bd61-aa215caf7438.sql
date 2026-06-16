
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fish_stock_user_caught ON public.fish_stock (user_id, caught_at);
