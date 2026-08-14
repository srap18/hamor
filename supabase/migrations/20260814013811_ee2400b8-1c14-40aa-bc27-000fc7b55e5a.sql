DROP POLICY IF EXISTS "read own event gold" ON public.tribe_fish_event_gold;
CREATE POLICY "read own event gold" ON public.tribe_fish_event_gold
FOR SELECT TO authenticated
USING (auth.uid() = user_id);