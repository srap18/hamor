
WITH ws AS (SELECT (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date) AS d)
INSERT INTO public.arena_scores(user_id, week_start, score, wins, updated_at)
SELECT a.attacker_id, (SELECT d FROM ws),
       SUM(GREATEST(0, COALESCE(a.damage_dealt,0)))::bigint,
       SUM(CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::int,
       now()
FROM public.attacks a
WHERE a.created_at >= (SELECT d FROM ws)
GROUP BY a.attacker_id
ON CONFLICT (user_id, week_start) DO UPDATE
  SET score = EXCLUDED.score, wins = EXCLUDED.wins, updated_at = now();
