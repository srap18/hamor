
-- ============ Tribe enemies (tribe vs tribe) ============
CREATE TABLE IF NOT EXISTS public.tribe_enemies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL REFERENCES public.tribes(id) ON DELETE CASCADE,
  enemy_tribe_id uuid NOT NULL REFERENCES public.tribes(id) ON DELETE CASCADE,
  added_by uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tribe_id, enemy_tribe_id),
  CHECK (tribe_id <> enemy_tribe_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tribe_enemies TO authenticated;
GRANT ALL ON public.tribe_enemies TO service_role;
ALTER TABLE public.tribe_enemies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tribe_enemies_read" ON public.tribe_enemies FOR SELECT TO authenticated USING (true);
CREATE POLICY "tribe_enemies_write" ON public.tribe_enemies FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tribe_members m
            WHERE m.tribe_id = tribe_enemies.tribe_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','leader'))
  );
CREATE POLICY "tribe_enemies_delete" ON public.tribe_enemies FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tribe_members m
            WHERE m.tribe_id = tribe_enemies.tribe_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','leader'))
  );

-- ============ Tribe enemy players (tribe vs player) ============
CREATE TABLE IF NOT EXISTS public.tribe_enemy_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL REFERENCES public.tribes(id) ON DELETE CASCADE,
  enemy_user_id uuid NOT NULL,
  added_by uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tribe_id, enemy_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tribe_enemy_players TO authenticated;
GRANT ALL ON public.tribe_enemy_players TO service_role;
ALTER TABLE public.tribe_enemy_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tribe_enemy_players_read" ON public.tribe_enemy_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "tribe_enemy_players_write" ON public.tribe_enemy_players FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tribe_members m
            WHERE m.tribe_id = tribe_enemy_players.tribe_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','leader'))
  );
CREATE POLICY "tribe_enemy_players_delete" ON public.tribe_enemy_players FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tribe_members m
            WHERE m.tribe_id = tribe_enemy_players.tribe_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','leader'))
  );

-- ============ Tribe achievements ============
CREATE TABLE IF NOT EXISTS public.tribe_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL REFERENCES public.tribes(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  emoji text DEFAULT '🏆',
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tribe_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tribe_achievements TO authenticated;
GRANT ALL ON public.tribe_achievements TO service_role;
ALTER TABLE public.tribe_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tribe_achievements_read" ON public.tribe_achievements FOR SELECT TO authenticated USING (true);
CREATE POLICY "tribe_achievements_write" ON public.tribe_achievements FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tribe_members m
            WHERE m.tribe_id = tribe_achievements.tribe_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','leader'))
  );
CREATE POLICY "tribe_achievements_delete" ON public.tribe_achievements FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tribe_members m
            WHERE m.tribe_id = tribe_achievements.tribe_id AND m.user_id = auth.uid()
              AND m.role = 'owner')
  );

-- ============ Notify tribe-mates when a member is attacked ============
CREATE OR REPLACE FUNCTION public.notify_tribe_on_attack()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tribe uuid;
  _victim_name text;
  _attacker_name text;
  _mate record;
BEGIN
  IF NEW.defender_id IS NULL OR NEW.attacker_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.defender_id = NEW.attacker_id THEN RETURN NEW; END IF;

  SELECT tribe_id, COALESCE(display_name, username, 'لاعب')
    INTO _tribe, _victim_name
  FROM public.profiles WHERE id = NEW.defender_id;

  IF _tribe IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(display_name, username, 'مهاجم')
    INTO _attacker_name
  FROM public.profiles WHERE id = NEW.attacker_id;

  FOR _mate IN
    SELECT user_id FROM public.tribe_members
    WHERE tribe_id = _tribe AND user_id <> NEW.defender_id
  LOOP
    INSERT INTO public.notifications (recipient_id, created_by, kind, title, body)
    VALUES (
      _mate.user_id,
      NEW.attacker_id,
      'attack',
      '🚨 هجوم على قبيلتك',
      _attacker_name || ' هاجم ' || _victim_name
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attacks_notify_tribe ON public.attacks;
CREATE TRIGGER attacks_notify_tribe
  AFTER INSERT ON public.attacks
  FOR EACH ROW EXECUTE FUNCTION public.notify_tribe_on_attack();

-- ============ Auto-award level achievements (best-effort) ============
CREATE OR REPLACE FUNCTION public.tribe_award_level_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.level IS DISTINCT FROM OLD.level AND NEW.level > COALESCE(OLD.level, 0) THEN
    INSERT INTO public.tribe_achievements (tribe_id, code, title, description, emoji)
    VALUES (NEW.id, 'level_' || NEW.level, 'وصلنا المستوى ' || NEW.level, 'القبيلة بلغت المستوى ' || NEW.level, '⭐')
    ON CONFLICT (tribe_id, code) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tribes_award_level ON public.tribes;
CREATE TRIGGER tribes_award_level
  AFTER UPDATE OF level ON public.tribes
  FOR EACH ROW EXECUTE FUNCTION public.tribe_award_level_achievement();
