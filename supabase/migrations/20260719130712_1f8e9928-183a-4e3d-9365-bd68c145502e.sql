
-- Behavior-preserving no-op elimination on user_achievements & quest_progress.
-- Skip UPDATE when progress is already at goal (result would be identical).

CREATE OR REPLACE FUNCTION public.bump_achievement_progress(_user uuid, _goal_type text, _delta integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user IS NULL OR _delta IS NULL OR _delta <= 0 THEN RETURN; END IF;
  INSERT INTO public.user_achievements (user_id, achievement_id, progress, claimed)
  SELECT _user, a.id, LEAST(_delta, a.goal_count), false
    FROM public.achievements a
   WHERE a.active = true AND a.goal_type = _goal_type
  ON CONFLICT (user_id, achievement_id) DO UPDATE
    SET progress = LEAST(public.user_achievements.progress + _delta,
                         (SELECT goal_count FROM public.achievements WHERE id = public.user_achievements.achievement_id))
    WHERE public.user_achievements.progress
          < (SELECT goal_count FROM public.achievements WHERE id = public.user_achievements.achievement_id);
END $function$;

CREATE OR REPLACE FUNCTION public.bump_quest_progress(_user uuid, _goal_type text, _delta integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _day text := public.qa_day_key();
BEGIN
  IF _user IS NULL OR _delta IS NULL OR _delta <= 0 THEN RETURN; END IF;
  INSERT INTO public.quest_progress (user_id, quest_id, progress, claimed, day_key)
  SELECT _user, q.id, LEAST(_delta, q.goal_count), false, _day
    FROM public.daily_quests q
   WHERE q.active = true AND q.goal_type = _goal_type
  ON CONFLICT (user_id, quest_id, day_key) DO UPDATE
    SET progress = LEAST(public.quest_progress.progress + _delta,
                         (SELECT goal_count FROM public.daily_quests WHERE id = public.quest_progress.quest_id)),
        updated_at = now()
    WHERE public.quest_progress.progress
          < (SELECT goal_count FROM public.daily_quests WHERE id = public.quest_progress.quest_id);
END $function$;
