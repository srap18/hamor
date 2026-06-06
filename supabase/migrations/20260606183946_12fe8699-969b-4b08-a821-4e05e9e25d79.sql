CREATE TABLE IF NOT EXISTS public.user_layout (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  position jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_layout TO authenticated;
GRANT ALL ON public.user_layout TO service_role;

ALTER TABLE public.user_layout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_layout_select_own" ON public.user_layout
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_layout_insert_own" ON public.user_layout
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_layout_update_own" ON public.user_layout
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_layout_delete_own" ON public.user_layout
  FOR DELETE TO authenticated USING (auth.uid() = user_id);