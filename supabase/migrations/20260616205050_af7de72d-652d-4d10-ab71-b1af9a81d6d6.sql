DROP POLICY IF EXISTS adb_read_participants ON public.ad_bombs;
DROP POLICY IF EXISTS adb_read_active ON public.ad_bombs;

CREATE POLICY adb_read_active
ON public.ad_bombs
FOR SELECT
TO authenticated
USING (active = true AND expires_at > now());

CREATE POLICY adb_read_participants
ON public.ad_bombs
FOR SELECT
TO authenticated
USING (
  auth.uid() = attacker_id
  OR auth.uid() = target_user_id
  OR public.is_admin(auth.uid())
);