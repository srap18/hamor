-- Rewrite the legacy no-arg finalize_ship_repairs() as a smart wrapper:
--   * When called by an authenticated user (old published client OR anything with auth.uid()),
--     it scopes work to that user's ships only — eliminating cross-user lock contention.
--   * When called by pg_cron (no auth.uid()), it falls back to the original global sweep
--     so scheduled maintenance keeps working exactly as before.
-- Repair math, timers, and side-effects are IDENTICAL to the previous version.
-- No player data is modified, deleted, or restructured.
CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Per-user fast path: delegate to the user-scoped version to avoid table-wide locks.
  IF _uid IS NOT NULL THEN
    PERFORM public.finalize_ship_repairs(_uid);
    RETURN;
  END IF;

  -- Cron / service path: original global sweep, unchanged behavior.
  UPDATE public.ships_owned AS so
     SET repair_ends_at = so.destroyed_at
       + make_interval(secs =>
           ROUND(60 + (LEAST(30, GREATEST(1, COALESCE(so.template_id, 1))) - 1)
                      * (14400 - 60) / 29.0)::int)
   WHERE so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NULL;

  UPDATE public.ships_owned
     SET hp = COALESCE(max_hp, 100),
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE repair_ends_at IS NOT NULL
     AND repair_ends_at <= now();

  UPDATE public.ships_owned AS so
     SET hp = LEAST(
                COALESCE(so.max_hp, 100),
                GREATEST(
                  COALESCE(so.hp, 0),
                  FLOOR(
                    COALESCE(so.max_hp, 100)::numeric
                    * EXTRACT(EPOCH FROM (now() - so.destroyed_at))::numeric
                    / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
                  )::integer
                )
              )
   WHERE so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NOT NULL
     AND so.repair_ends_at > now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_ship_repairs() TO anon, authenticated, service_role;