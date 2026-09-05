CREATE TABLE IF NOT EXISTS public._daily_reward_test_log (
  day int, r_type text, r_id text, qty int, before_v bigint, after_v bigint, ok boolean, at timestamptz default now()
);
GRANT ALL ON public._daily_reward_test_log TO service_role;
ALTER TABLE public._daily_reward_test_log ENABLE ROW LEVEL SECURITY;