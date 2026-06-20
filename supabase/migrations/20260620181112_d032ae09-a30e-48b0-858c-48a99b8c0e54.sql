
-- Recalibrate XP curve: cost(L->L+1) = floor(10 * L^1.5)
DELETE FROM public.level_xp_table;
WITH per AS (
  SELECT lv AS level, FLOOR(10 * POWER(lv, 1.5))::bigint AS cost
  FROM generate_series(1, 1000) AS lv
)
INSERT INTO public.level_xp_table(level, cumulative_xp, to_next)
SELECT
  p.level,
  COALESCE((SELECT SUM(cost) FROM per WHERE per.level < p.level), 0)::bigint,
  p.cost
FROM per p;

-- Recompute players' levels under the new curve, then refresh skill points
DO $do$
DECLARE _max_xp bigint;
BEGIN
  SELECT cumulative_xp INTO _max_xp FROM public.level_xp_table WHERE level = 1000;
  UPDATE public.profiles SET xp = LEAST(xp, _max_xp) WHERE xp > _max_xp;
  UPDATE public.profiles SET level = public.level_from_xp(xp);
  UPDATE public.profiles
     SET skill_points = GREATEST(0, level - 1
                                 - skill_str - skill_def - skill_luck - skill_fish - skill_speed);
END $do$;
