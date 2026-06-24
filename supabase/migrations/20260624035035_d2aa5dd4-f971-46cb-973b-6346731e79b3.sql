SET lock_timeout = '15s';

CREATE OR REPLACE FUNCTION public._stamp_competition_catch_tribe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tribe_id IS NULL THEN
    SELECT tribe_id INTO NEW.tribe_id FROM public.profiles WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_competition_catch_tribe ON public.competition_catches;
CREATE TRIGGER trg_stamp_competition_catch_tribe
BEFORE INSERT ON public.competition_catches
FOR EACH ROW EXECUTE FUNCTION public._stamp_competition_catch_tribe();

CREATE OR REPLACE FUNCTION public.tribe_fish_event_leaderboard(p_event_id uuid)
RETURNS TABLE(tribe_id uuid, tribe_name text, tribe_emblem text, tribe_banner text, members_count bigint, total_fish bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT starts_at, ends_at FROM public.tribe_fish_events WHERE id = p_event_id
  ),
  catches AS (
    SELECT COALESCE(cc.tribe_id, p.tribe_id) AS tribe_id, SUM(cc.qty)::bigint AS total
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    CROSS JOIN ev
    WHERE COALESCE(cc.tribe_id, p.tribe_id) IS NOT NULL
      AND cc.caught_at >= ev.starts_at
      AND cc.caught_at <= ev.ends_at
    GROUP BY COALESCE(cc.tribe_id, p.tribe_id)
  )
  SELECT
    t.id, t.name, t.emblem, t.banner,
    (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
    COALESCE(c.total, 0)::bigint
  FROM public.tribes t
  LEFT JOIN catches c ON c.tribe_id = t.id
  WHERE COALESCE(c.total, 0) > 0
  ORDER BY COALESCE(c.total, 0) DESC, t.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.tribe_fish_event_leaderboard(uuid) TO authenticated, anon;