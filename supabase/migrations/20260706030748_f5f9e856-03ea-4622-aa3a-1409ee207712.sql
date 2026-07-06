
CREATE POLICY "msg_select_admin" ON public.messages FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "adb_delete_admin" ON public.ad_bombs FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "destroyer_msg_delete_admin" ON public.destroyer_messages FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
