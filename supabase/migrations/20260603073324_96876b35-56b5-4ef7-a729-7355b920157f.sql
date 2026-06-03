
CREATE POLICY profile_media_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'profile-media');

CREATE POLICY profile_media_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-media' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY profile_media_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'profile-media' AND ((auth.uid())::text = (storage.foldername(name))[1] OR is_admin(auth.uid())));
