CREATE OR REPLACE FUNCTION public.fish_market_upgrade_cost(_level integer)
RETURNS TABLE(cost_coins bigint, seconds integer)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (50000 * power(1.8, GREATEST(_level, 1) - 1))::bigint AS cost_coins,
    (CASE
      WHEN _level = 26 THEN 7200
      WHEN _level = 27 THEN 14400
      WHEN _level = 28 THEN 28800
      WHEN _level = 29 THEN 57600
      ELSE (30 + GREATEST(_level, 1) * 60)
    END)::int AS seconds;
$$;