
-- 1) Backfill: stamp tribe_id on any catch missing it, using the player's current tribe
UPDATE public.competition_catches cc
SET tribe_id = p.tribe_id
FROM public.profiles p
WHERE cc.user_id = p.id
  AND cc.tribe_id IS NULL
  AND p.tribe_id IS NOT NULL;

-- 2) Make the leaderboard rely ONLY on the stamped tribe_id so points don't
--    disappear when a member later leaves their tribe.
CREATE OR REPLACE FUNCTION public.tribe_fish_event_leaderboard(p_event_id uuid)
RETURNS TABLE(tribe_id uuid, tribe_name text, tribe_emblem text, tribe_banner text, members_count bigint, total_fish bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT starts_at, ends_at FROM public.tribe_fish_events WHERE id = p_event_id
  ),
  catches AS (
    SELECT cc.tribe_id AS tribe_id, SUM(cc.qty)::bigint AS total
    FROM public.competition_catches cc
    CROSS JOIN ev
    WHERE cc.tribe_id IS NOT NULL
      AND cc.caught_at >= ev.starts_at
      AND cc.caught_at <= ev.ends_at
    GROUP BY cc.tribe_id
  )
  SELECT
    t.id, t.name, t.emblem, t.banner,
    (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
    COALESCE(c.total, 0)::bigint
  FROM public.tribes t
  LEFT JOIN catches c ON c.tribe_id = t.id
  WHERE COALESCE(c.total, 0) > 0
  ORDER BY COALESCE(c.total, 0) DESC, t.name ASC;
$function$;
