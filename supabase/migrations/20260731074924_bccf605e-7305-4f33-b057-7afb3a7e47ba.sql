CREATE OR REPLACE FUNCTION public._steal_seconds_for(_cat ship_catalog)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Stealing with a ship must always be SLOWER than fishing with that same
  -- ship: base = ship fishing duration * 1.4 (thief crew still cuts it by 30%,
  -- which keeps it at ~1.08x fishing time).
  SELECT GREATEST(60,
    CEIL(
      COALESCE(
        NULLIF(_cat.fishing_seconds, 0),
        GREATEST(60, ROUND(1800.0 / GREATEST(1, COALESCE(_cat.speed, 10))))
      ) * 1.4
    )
  )::int;
$function$;