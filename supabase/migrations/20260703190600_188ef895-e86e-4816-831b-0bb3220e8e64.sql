
DROP POLICY IF EXISTS users_select_own_tickets ON public.support_tickets;
DROP POLICY IF EXISTS admins_update_tickets ON public.support_tickets;
DROP POLICY IF EXISTS admins_delete_tickets ON public.support_tickets;

CREATE POLICY users_select_own_tickets ON public.support_tickets
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'moderator'::app_role)
  );

CREATE POLICY admins_update_tickets ON public.support_tickets
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'moderator'::app_role)
  );

CREATE POLICY admins_delete_tickets ON public.support_tickets
  FOR DELETE USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'moderator'::app_role)
  );

-- Support ticket messages: allow moderators too
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='support_ticket_messages' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.support_ticket_messages', p.policyname);
  END LOOP;
END $$;

CREATE POLICY stm_select ON public.support_ticket_messages
  FOR SELECT USING (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'moderator'::app_role)
  );

CREATE POLICY stm_insert ON public.support_ticket_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND (
      EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'moderator'::app_role)
    )
  );
