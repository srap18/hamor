
-- Personal enemies pinned by a user from notifications
CREATE TABLE IF NOT EXISTS public.user_enemies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enemy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, enemy_id),
  CHECK (user_id <> enemy_id)
);

GRANT SELECT, INSERT, DELETE ON public.user_enemies TO authenticated;
GRANT ALL ON public.user_enemies TO service_role;

ALTER TABLE public.user_enemies ENABLE ROW LEVEL SECURITY;

-- Owners manage their own list
CREATE POLICY "owner_select" ON public.user_enemies
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON public.user_enemies
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_delete" ON public.user_enemies
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- The target can SEE that they were marked (for "knows you flagged them")
CREATE POLICY "target_can_see" ON public.user_enemies
  FOR SELECT TO authenticated USING (auth.uid() = enemy_id);

CREATE INDEX IF NOT EXISTS idx_user_enemies_user ON public.user_enemies(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_enemies_enemy ON public.user_enemies(enemy_id);

-- Trigger: notify the target when they get marked
CREATE OR REPLACE FUNCTION public.notify_user_enemy_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  marker_name text;
BEGIN
  SELECT display_name INTO marker_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.notifications (kind, title, body, recipient_id, created_by)
  VALUES (
    'enemy',
    '🚩 تم تحديدك كعدو',
    COALESCE(marker_name, 'لاعب') || ' وضعك كعدو شخصي له',
    NEW.enemy_id,
    NEW.user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_user_enemy_added ON public.user_enemies;
CREATE TRIGGER trg_notify_user_enemy_added
AFTER INSERT ON public.user_enemies
FOR EACH ROW EXECUTE FUNCTION public.notify_user_enemy_added();
