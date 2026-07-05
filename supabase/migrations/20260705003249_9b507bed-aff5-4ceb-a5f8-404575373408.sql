
CREATE TABLE IF NOT EXISTS public.sign_slot_layout (
  bg_id TEXT PRIMARY KEY,
  top_pct NUMERIC NOT NULL DEFAULT 62,
  left_pct NUMERIC NOT NULL DEFAULT 30,
  width_pct NUMERIC NOT NULL DEFAULT 9,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sign_slot_layout TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sign_slot_layout TO authenticated;
GRANT ALL ON public.sign_slot_layout TO service_role;
ALTER TABLE public.sign_slot_layout ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sign_slot_layout readable by all" ON public.sign_slot_layout FOR SELECT USING (true);
CREATE POLICY "sign_slot_layout admins write" ON public.sign_slot_layout FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
ALTER PUBLICATION supabase_realtime ADD TABLE public.sign_slot_layout;
