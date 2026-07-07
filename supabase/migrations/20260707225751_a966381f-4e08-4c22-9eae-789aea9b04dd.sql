
CREATE OR REPLACE FUNCTION public.get_tribe_effort_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(tribe_id uuid, name text, emblem text, banner text, level integer, members integer, donation_score bigint, support_score bigint, attack_score bigint, power bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH member_stats AS (
    SELECT p.tribe_id,
           COUNT(*)::integer AS members,
           COALESCE(SUM(GREATEST(p.total_damage_dealt, 0)), 0)::bigint AS damage_sum
    FROM public.profiles p
    WHERE p.tribe_id IS NOT NULL
      AND NOT public.is_admin(p.id)
    GROUP BY p.tribe_id
  )
  SELECT t.id,
         t.name,
         t.emblem,
         t.banner,
         COALESCE(t.level, 1) AS level,
         COALESCE(ms.members, 0) AS members,
         GREATEST(0, COALESCE(t.total_donations, 0))::bigint AS donation_score,
         0::bigint AS support_score,
         COALESCE(ms.damage_sum, 0) AS attack_score,
         COALESCE(ms.damage_sum, 0) AS power
  FROM public.tribes t
  LEFT JOIN member_stats ms ON ms.tribe_id = t.id
  WHERE COALESCE(ms.members, 0) > 0
  ORDER BY power DESC, COALESCE(ms.members,0) DESC, t.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 200));
END;
$function$;
