
-- Allow both the ticket owner and admins/moderators to upload and read
-- files stored under tickets/<ticketId>/... inside the support-tickets bucket.
DROP POLICY IF EXISTS support_tickets_participants_read ON storage.objects;
DROP POLICY IF EXISTS support_tickets_participants_upload ON storage.objects;

CREATE POLICY support_tickets_participants_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'support-tickets'
  AND (storage.foldername(name))[1] = 'tickets'
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id::text = (storage.foldername(name))[2]
      AND (
        t.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'moderator'::public.app_role)
      )
  )
);

CREATE POLICY support_tickets_participants_upload ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'support-tickets'
  AND (storage.foldername(name))[1] = 'tickets'
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id::text = (storage.foldername(name))[2]
      AND (
        t.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'moderator'::public.app_role)
      )
  )
);
