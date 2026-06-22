DROP POLICY IF EXISTS cm_chatmod_update_own ON public.chat_mutes;
CREATE POLICY cm_chatmod_update_any ON public.chat_mutes
  FOR UPDATE TO authenticated
  USING (is_chat_mod(auth.uid()))
  WITH CHECK (is_chat_mod(auth.uid()));