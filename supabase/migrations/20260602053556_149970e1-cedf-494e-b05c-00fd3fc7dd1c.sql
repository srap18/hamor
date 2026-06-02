CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, score bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN
    RETURN;
  END IF;

  IF c.metric = 'explode_count' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND a.damage_dealt > 0
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;
  END IF;
END;
$function$;