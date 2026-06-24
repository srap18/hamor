CREATE OR REPLACE FUNCTION public.tribe_fish_event_member_leaderboard(p_event_id uuid, p_tribe_id uuid)
RETURNS TABLE(user_id uuid, username text, avatar_url text, total_fish bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ev AS (
    SELECT starts_at, ends_at FROM public.tribe_fish_events WHERE id = p_event_id
  )
  SELECT
    p.id,
    COALESCE(p.username, 'لاعب'),
    p.avatar_url,
    COALESCE(SUM(cc.qty), 0)::bigint AS total_fish
  FROM public.profiles p
  CROSS JOIN ev
  LEFT JOIN public.competition_catches cc
    ON cc.user_id = p.id
   AND cc.caught_at >= ev.starts_at
   AND cc.caught_at <= ev.ends_at
  WHERE p.tribe_id = p_tribe_id
  GROUP BY p.id, p.username, p.avatar_url
  HAVING COALESCE(SUM(cc.qty), 0) > 0
  ORDER BY total_fish DESC, p.username ASC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.tribe_fish_event_member_leaderboard(uuid, uuid) TO authenticated, anon;