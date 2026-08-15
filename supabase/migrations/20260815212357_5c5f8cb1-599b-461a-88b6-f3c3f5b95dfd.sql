CREATE OR REPLACE FUNCTION public.fish_market_upgrade_cost(_level integer)
 RETURNS TABLE(cost_coins bigint, seconds integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    GREATEST(1, ROUND(0.5 * (SELECT m.cost_coins FROM public.market_upgrade_cost(GREATEST(_level, 1)) m)::numeric))::bigint AS cost_coins,
    (CASE
      WHEN _level = 26 THEN 7200
      WHEN _level = 27 THEN 14400
      WHEN _level = 28 THEN 28800
      WHEN _level = 29 THEN 57600
      ELSE (30 + GREATEST(_level, 1) * 60)
    END)::int AS seconds;
$function$;