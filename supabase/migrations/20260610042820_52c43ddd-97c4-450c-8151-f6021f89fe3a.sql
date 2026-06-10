CREATE OR REPLACE FUNCTION public.fish_market_upgrade_cost(_level integer)
RETURNS TABLE(cost_coins bigint, seconds integer)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT
    (CASE
      WHEN GREATEST(LEAST(_level, 29), 1) <= 19 THEN
        GREATEST(
          1000::bigint,
          ROUND(1000.0 * power(500.0, (GREATEST(LEAST(_level, 19), 1) - 1) / 18.0))::bigint
        )
      ELSE
        ROUND(0.55 * 20000000.0 * power(25.0, (LEAST(_level, 29) - 20) / 9.0))::bigint
    END) AS cost_coins,
    (CASE
      WHEN _level = 26 THEN 7200
      WHEN _level = 27 THEN 14400
      WHEN _level = 28 THEN 28800
      WHEN _level = 29 THEN 57600
      ELSE (30 + GREATEST(_level, 1) * 60)
    END)::int AS seconds;
$function$;