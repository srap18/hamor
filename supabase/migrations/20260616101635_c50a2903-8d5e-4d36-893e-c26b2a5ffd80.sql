CREATE POLICY "support_tickets_user_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-tickets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "support_tickets_user_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-tickets'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(),'admin'))
  );

CREATE POLICY "support_tickets_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'support-tickets'
    AND (public.has_role(auth.uid(),'admin') OR (storage.foldername(name))[1] = auth.uid()::text)
  );