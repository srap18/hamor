
ALTER FUNCTION public.fish_market_capacity(integer) SET search_path = public;
ALTER FUNCTION public.fish_market_upgrade_cost(integer) SET search_path = public;
ALTER FUNCTION public.submarine_capacity_for_stars(integer) SET search_path = public;
ALTER FUNCTION public.tribe_level_from_donations(bigint) SET search_path = public;

DROP POLICY IF EXISTS "voice notes auth insert" ON storage.objects;
CREATE POLICY "voice notes auth insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'voice-notes'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS user_layout_public_read ON public.user_layout;
CREATE POLICY user_layout_select_own ON public.user_layout
FOR SELECT TO authenticated
USING (auth.uid() = user_id);
