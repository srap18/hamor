DROP POLICY IF EXISTS "user_layout_select_own" ON public.user_layout;

CREATE POLICY "user_layout_public_read" ON public.user_layout
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.user_layout TO anon;