
CREATE TABLE IF NOT EXISTS public.daily_login_streaks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  last_claim_date date,
  total_claims integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_login_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dls_select_own" ON public.daily_login_streaks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "dls_insert_own" ON public.daily_login_streaks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dls_update_own" ON public.daily_login_streaks
  FOR UPDATE USING (auth.uid() = user_id);
