CREATE TABLE IF NOT EXISTS public.unmapped_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paddle_transaction_id text UNIQUE NOT NULL,
  reason text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  environment text NOT NULL,
  email text,
  user_id_hint uuid,
  pack_id_hint text,
  raw jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.unmapped_payments TO authenticated;
GRANT ALL ON public.unmapped_payments TO service_role;
ALTER TABLE public.unmapped_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read unmapped_payments" ON public.unmapped_payments
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins update unmapped_payments" ON public.unmapped_payments
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));