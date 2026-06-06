CREATE TABLE public.site_layout (
  key TEXT PRIMARY KEY,
  position JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT ON public.site_layout TO anon, authenticated;
GRANT ALL ON public.site_layout TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.site_layout TO authenticated;

ALTER TABLE public.site_layout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read layout"
ON public.site_layout FOR SELECT
USING (true);

CREATE POLICY "Admins can insert layout"
ON public.site_layout FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update layout"
ON public.site_layout FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete layout"
ON public.site_layout FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Enable realtime so layout changes propagate live
ALTER PUBLICATION supabase_realtime ADD TABLE public.site_layout;