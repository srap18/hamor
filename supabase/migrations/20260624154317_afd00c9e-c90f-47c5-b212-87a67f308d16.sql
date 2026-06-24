-- Remove duplicated fish catches caused by golden_fisher bug before today's fix.
-- A duplicate = a fish_stock row where the previous catch on the same ship
-- happened less than the ship's natural fishing duration ago (impossible
-- without the bug). Scope: last 1 hour, since the fix is now in place.
WITH dup AS (
  SELECT fs.id, fs.ship_id, fs.caught_at,
         LAG(fs.caught_at) OVER (PARTITION BY fs.ship_id ORDER BY fs.caught_at) AS prev_at,
         GREATEST(60, COALESCE(c.fishing_seconds, 600)) AS dur
  FROM public.fish_stock fs
  JOIN public.ships_owned s ON s.id = fs.ship_id
  JOIN public.ship_catalog c ON c.code = s.catalog_code
  WHERE fs.caught_at > now() - interval '1 hour'
)
DELETE FROM public.fish_stock fs
USING dup
WHERE fs.id = dup.id
  AND dup.prev_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (dup.caught_at - dup.prev_at)) < dup.dur;