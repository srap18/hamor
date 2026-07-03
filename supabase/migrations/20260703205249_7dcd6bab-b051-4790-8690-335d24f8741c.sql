
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reports_disabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('chat','ad_bomb','destroyer')),
  source_id text,
  message_body text NOT NULL DEFAULT '',
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_reports_status_idx ON public.message_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS message_reports_reporter_idx ON public.message_reports(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_reports_reported_idx ON public.message_reports(reported_user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reports TO authenticated;
GRANT ALL ON public.message_reports TO service_role;

ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_insert_own_reports" ON public.message_reports;
CREATE POLICY "users_insert_own_reports" ON public.message_reports
FOR INSERT TO authenticated
WITH CHECK (
  reporter_id = auth.uid()
  AND reported_user_id <> auth.uid()
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.reports_disabled = true)
);

DROP POLICY IF EXISTS "users_select_own_reports_or_admin" ON public.message_reports;
CREATE POLICY "users_select_own_reports_or_admin" ON public.message_reports
FOR SELECT TO authenticated
USING (
  reporter_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'moderator'::app_role)
);

DROP POLICY IF EXISTS "admins_update_reports" ON public.message_reports;
CREATE POLICY "admins_update_reports" ON public.message_reports
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role));

DROP POLICY IF EXISTS "admins_delete_reports" ON public.message_reports;
CREATE POLICY "admins_delete_reports" ON public.message_reports
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role));
