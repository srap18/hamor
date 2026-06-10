CREATE OR REPLACE FUNCTION public.fish_market_upgrade_cost(_level integer)
 RETURNS TABLE(cost_coins bigint, seconds integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    -- Weighted geometric curve: L=1 -> 1,000,000  ...  L=29 -> 200,000,000
    GREATEST(
      1000000::bigint,
      ROUND(1000000.0 * power(200.0, (GREATEST(LEAST(_level, 29), 1) - 1) / 28.0))::bigint
    ) AS cost_coins,
    (CASE
      WHEN _level = 26 THEN 7200
      WHEN _level = 27 THEN 14400
      WHEN _level = 28 THEN 28800
      WHEN _level = 29 THEN 57600
      ELSE (30 + GREATEST(_level, 1) * 60)
    END)::int AS seconds;
$function$;