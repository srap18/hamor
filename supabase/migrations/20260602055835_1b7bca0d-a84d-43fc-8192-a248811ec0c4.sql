CREATE OR REPLACE FUNCTION public.get_tribe_effort_leaderboard(_limit integer DEFAULT 100)
RETURNS TABLE(
  tribe_id uuid,
  name text,
  emblem text,
  banner text,
  level integer,
  members integer,
  donation_score bigint,
  support_score bigint,
  attack_score bigint,
  power bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH member_counts AS (
    SELECT p.tribe_id, COUNT(*)::integer AS members
    FROM public.profiles p
    WHERE p.tribe_id IS NOT NULL
    GROUP BY p.tribe_id
  ),
  support AS (
    SELECT sp.tribe_id,
           COALESCE(SUM(
             CASE
               WHEN sg.kind = 'gems' THEN GREATEST(0, sg.amount) * 1000
               WHEN sg.kind = 'repair' THEN GREATEST(0, sg.amount) * 350
               WHEN sg.kind = 'crew' THEN GREATEST(0, sg.amount) * 500
               ELSE GREATEST(0, sg.amount)
             END
           ), 0)::bigint AS score
    FROM public.support_gifts sg
    JOIN public.profiles sp ON sp.id = sg.sender_id
    JOIN public.profiles rp ON rp.id = sg.recipient_id
    WHERE sp.tribe_id IS NOT NULL
      AND sp.tribe_id = rp.tribe_id
      AND sg.sender_id <> sg.recipient_id
    GROUP BY sp.tribe_id
  ),
  attacks_by_tribe AS (
    SELECT ap.tribe_id,
           COALESCE(SUM(GREATEST(0, a.damage_dealt)), 0)::bigint
           + (COUNT(*)::bigint * 250)
           + (COUNT(*) FILTER (WHERE COALESCE(a.attacker_won, false))::bigint * 1500)
           + COALESCE(SUM(GREATEST(0, a.loot_coins) / 100), 0)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles ap ON ap.id = a.attacker_id
    WHERE ap.tribe_id IS NOT NULL
    GROUP BY ap.tribe_id
  )
  SELECT t.id AS tribe_id,
         t.name,
         t.emblem,
         t.banner,
         COALESCE(t.level, 1) AS level,
         COALESCE(mc.members, 0) AS members,
         GREATEST(0, COALESCE(t.total_donations, 0))::bigint AS donation_score,
         COALESCE(s.score, 0)::bigint AS support_score,
         COALESCE(a.score, 0)::bigint AS attack_score,
         (
           GREATEST(0, COALESCE(t.total_donations, 0))::bigint
           + COALESCE(s.score, 0)::bigint
           + COALESCE(a.score, 0)::bigint
           + (COALESCE(mc.members, 0)::bigint * 100)
         )::bigint AS power
  FROM public.tribes t
  LEFT JOIN member_counts mc ON mc.tribe_id = t.id
  LEFT JOIN support s ON s.tribe_id = t.id
  LEFT JOIN attacks_by_tribe a ON a.tribe_id = t.id
  ORDER BY power DESC, attack_score DESC, support_score DESC, donation_score DESC, members DESC, level DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 200);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tribe_effort_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tribe_effort_leaderboard(integer) TO authenticated;