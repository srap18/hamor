
-- 1) Secret chat moderators table
CREATE TABLE IF NOT EXISTS public.chat_moderators (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

GRANT SELECT ON public.chat_moderators TO authenticated;
GRANT ALL ON public.chat_moderators TO service_role;

ALTER TABLE public.chat_moderators ENABLE ROW LEVEL SECURITY;

-- Only the moderator themselves OR a real admin can see the row (keep secret)
DROP POLICY IF EXISTS "chatmod_self_or_admin_select" ON public.chat_moderators;
CREATE POLICY "chatmod_self_or_admin_select" ON public.chat_moderators
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- Only admins manage the list
DROP POLICY IF EXISTS "chatmod_admin_manage" ON public.chat_moderators;
CREATE POLICY "chatmod_admin_manage" ON public.chat_moderators
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 2) Helper
CREATE OR REPLACE FUNCTION public.is_chat_mod(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_moderators WHERE user_id = _uid)
$$;

-- 3) Allow chat moderators to mute (max 24h) without elevating to full admin
DROP POLICY IF EXISTS "cm_chatmod_insert_24h" ON public.chat_mutes;
CREATE POLICY "cm_chatmod_insert_24h" ON public.chat_mutes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_chat_mod(auth.uid())
    AND muted_by = auth.uid()
    AND expires_at IS NOT NULL
    AND expires_at <= now() + interval '24 hours' + interval '2 minutes'
    AND expires_at > now()
  );

-- Allow chat mod to see active mutes (needed to display state on profile actions modal)
DROP POLICY IF EXISTS "cm_chatmod_select" ON public.chat_mutes;
CREATE POLICY "cm_chatmod_select" ON public.chat_mutes
  FOR SELECT TO authenticated
  USING (public.is_chat_mod(auth.uid()));

-- Allow chat mod to lift mutes they themselves issued
DROP POLICY IF EXISTS "cm_chatmod_update_own" ON public.chat_mutes;
CREATE POLICY "cm_chatmod_update_own" ON public.chat_mutes
  FOR UPDATE TO authenticated
  USING (public.is_chat_mod(auth.uid()) AND muted_by = auth.uid())
  WITH CHECK (public.is_chat_mod(auth.uid()) AND muted_by = auth.uid());

-- 4) Assign the requested user as a secret chat moderator
INSERT INTO public.chat_moderators (user_id)
VALUES ('1b0701bd-d595-4e9b-b25e-54f730df9807')
ON CONFLICT (user_id) DO NOTHING;
