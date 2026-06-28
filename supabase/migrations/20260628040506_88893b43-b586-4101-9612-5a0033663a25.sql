
DROP POLICY IF EXISTS "tribe_enemies_write" ON public.tribe_enemies;
DROP POLICY IF EXISTS "tribe_enemies_delete" ON public.tribe_enemies;
CREATE POLICY "tribe_enemies_write" ON public.tribe_enemies FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = tribe_enemies.tribe_id AND m.user_id = auth.uid() AND m.role IN ('owner','moderator')));
CREATE POLICY "tribe_enemies_delete" ON public.tribe_enemies FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = tribe_enemies.tribe_id AND m.user_id = auth.uid() AND m.role IN ('owner','moderator')));

DROP POLICY IF EXISTS "tribe_enemy_players_write" ON public.tribe_enemy_players;
DROP POLICY IF EXISTS "tribe_enemy_players_delete" ON public.tribe_enemy_players;
CREATE POLICY "tribe_enemy_players_write" ON public.tribe_enemy_players FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = tribe_enemy_players.tribe_id AND m.user_id = auth.uid() AND m.role IN ('owner','moderator')));
CREATE POLICY "tribe_enemy_players_delete" ON public.tribe_enemy_players FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = tribe_enemy_players.tribe_id AND m.user_id = auth.uid() AND m.role IN ('owner','moderator')));

DROP POLICY IF EXISTS "tribe_achievements_write" ON public.tribe_achievements;
CREATE POLICY "tribe_achievements_write" ON public.tribe_achievements FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = tribe_achievements.tribe_id AND m.user_id = auth.uid() AND m.role IN ('owner','moderator')));
