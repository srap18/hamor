
CREATE OR REPLACE FUNCTION public.ludo_is_in_room(_room uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.ludo_players WHERE room_id = _room AND user_id = _uid);
$$;

DROP POLICY IF EXISTS "view players" ON public.ludo_players;
CREATE POLICY "view players" ON public.ludo_players FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator')
  OR user_id = auth.uid()
  OR public.ludo_is_in_room(room_id, auth.uid())
);

DROP POLICY IF EXISTS "view rooms" ON public.ludo_rooms;
CREATE POLICY "view rooms" ON public.ludo_rooms FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator')
  OR status IN ('waiting','playing')
  OR public.ludo_is_in_room(id, auth.uid())
);

DROP POLICY IF EXISTS "view moves" ON public.ludo_moves;
CREATE POLICY "view moves" ON public.ludo_moves FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator')
  OR public.ludo_is_in_room(room_id, auth.uid())
);
