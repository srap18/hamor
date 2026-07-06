
DROP POLICY IF EXISTS "admins view rooms" ON public.ludo_rooms;
DROP POLICY IF EXISTS "view rooms" ON public.ludo_rooms;
CREATE POLICY "view rooms" ON public.ludo_rooms FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator')
  OR status IN ('waiting','playing')
  OR EXISTS (SELECT 1 FROM public.ludo_players p WHERE p.room_id = ludo_rooms.id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "admins view players" ON public.ludo_players;
DROP POLICY IF EXISTS "view players" ON public.ludo_players;
CREATE POLICY "view players" ON public.ludo_players FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator')
  OR user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.ludo_players me WHERE me.room_id = ludo_players.room_id AND me.user_id = auth.uid())
);

DROP POLICY IF EXISTS "admins view moves" ON public.ludo_moves;
DROP POLICY IF EXISTS "view moves" ON public.ludo_moves;
CREATE POLICY "view moves" ON public.ludo_moves FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator')
  OR EXISTS (SELECT 1 FROM public.ludo_players me WHERE me.room_id = ludo_moves.room_id AND me.user_id = auth.uid())
);
