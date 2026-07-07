CREATE TABLE public.play_rtdn_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL UNIQUE,
  notification_type text,
  purchase_token text,
  sku text,
  subscription_id text,
  raw jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_play_rtdn_purchase_token ON public.play_rtdn_events(purchase_token);
CREATE INDEX idx_play_rtdn_created_at ON public.play_rtdn_events(created_at DESC);
GRANT ALL ON public.play_rtdn_events TO service_role;
ALTER TABLE public.play_rtdn_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view RTDN events" ON public.play_rtdn_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));