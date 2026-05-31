
CREATE TABLE public.chat_mutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  muted_by uuid,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_mutes TO authenticated;
GRANT ALL ON public.chat_mutes TO service_role;

ALTER TABLE public.chat_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_admin_manage ON public.chat_mutes
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY cm_view_own ON public.chat_mutes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_admin(auth.uid()));

CREATE INDEX chat_mutes_user_active_idx ON public.chat_mutes(user_id) WHERE active;

CREATE OR REPLACE FUNCTION public.is_muted(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_mutes
    WHERE user_id = _user
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

DROP POLICY IF EXISTS msg_insert_public ON public.messages;
CREATE POLICY msg_insert_public ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (channel = 'public' AND auth.uid() = sender_id AND NOT is_muted(auth.uid()));

DROP POLICY IF EXISTS msg_insert_tribe ON public.messages;
CREATE POLICY msg_insert_tribe ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (channel = 'tribe' AND auth.uid() = sender_id AND tribe_id IS NOT NULL AND is_tribe_member(auth.uid(), tribe_id) AND NOT is_muted(auth.uid()));
