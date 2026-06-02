CREATE OR REPLACE FUNCTION public.get_tribe_effort_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(tribe_id uuid, name text, emblem text, banner text, level integer, members integer, donation_score bigint, support_score bigint, attack_score bigint, power bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH member_counts AS (
    SELECT p.tribe_id, COUNT(*)::integer AS members
    FROM public.profiles p
    WHERE p.tribe_id IS NOT NULL
    GROUP BY p.tribe_id
  )
  SELECT t.id AS tribe_id,
         t.name,
         t.emblem,
         t.banner,
         COALESCE(t.level, 1) AS level,
         COALESCE(mc.members, 0) AS members,
         GREATEST(0, COALESCE(t.total_donations, 0))::bigint AS donation_score,
         0::bigint AS support_score,
         0::bigint AS attack_score,
         GREATEST(0, COALESCE(t.total_donations, 0))::bigint AS power
  FROM public.tribes t
  LEFT JOIN member_counts mc ON mc.tribe_id = t.id
  ORDER BY GREATEST(0, COALESCE(t.total_donations, 0)) DESC,
           COALESCE(t.level, 1) DESC,
           t.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 100));
END;
$function$;