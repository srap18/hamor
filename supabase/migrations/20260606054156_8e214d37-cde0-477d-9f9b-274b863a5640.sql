
DROP POLICY IF EXISTS profile_media_public_read ON storage.objects;

CREATE POLICY profile_media_album_read ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'profile-media'
  AND public.can_view_album(
    auth.uid(),
    NULLIF((storage.foldername(name))[1], '')::uuid
  )
);

DROP POLICY IF EXISTS msg_insert_public ON public.messages;
CREATE POLICY msg_insert_public ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  channel = 'public'
  AND auth.uid() = sender_id
  AND NOT public.is_muted(auth.uid())
  AND NOT public.is_banned(auth.uid())
);

DROP POLICY IF EXISTS msg_insert_dm ON public.messages;
CREATE POLICY msg_insert_dm ON public.messages
FOR INSERT TO public
WITH CHECK (
  channel = 'dm'
  AND auth.uid() = sender_id
  AND recipient_id IS NOT NULL
  AND NOT public.is_muted(auth.uid())
  AND NOT public.is_banned(auth.uid())
);

DROP POLICY IF EXISTS msg_insert_tribe ON public.messages;
CREATE POLICY msg_insert_tribe ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  channel = 'tribe'
  AND auth.uid() = sender_id
  AND tribe_id IS NOT NULL
  AND public.is_tribe_member(auth.uid(), tribe_id)
  AND NOT public.is_muted(auth.uid())
  AND NOT public.is_banned(auth.uid())
);

DROP POLICY IF EXISTS atk_insert_attacker ON public.attacks;
CREATE POLICY atk_insert_attacker ON public.attacks
FOR INSERT TO public
WITH CHECK (
  auth.uid() = attacker_id
  AND attacker_id <> defender_id
  AND NOT public.is_banned(auth.uid())
);

DROP POLICY IF EXISTS friends_insert_requester ON public.friends;
CREATE POLICY friends_insert_requester ON public.friends
FOR INSERT TO public
WITH CHECK (
  auth.uid() = requester_id
  AND requester_id <> addressee_id
  AND NOT public.is_banned(auth.uid())
);

DROP POLICY IF EXISTS ft_insert_own ON public.forum_topics;
CREATE POLICY ft_insert_own ON public.forum_topics
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND NOT public.is_banned(auth.uid()));

DROP POLICY IF EXISTS fr_insert_own ON public.forum_replies;
CREATE POLICY fr_insert_own ON public.forum_replies
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND NOT public.is_banned(auth.uid()));

DROP POLICY IF EXISTS pm_insert_own ON public.profile_media;
CREATE POLICY pm_insert_own ON public.profile_media
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND NOT public.is_banned(auth.uid()));
