
-- User-scoped version of finalize_ship_repairs.
-- Identical math/logic to the global version, just scoped to a single user
-- so concurrent player requests do not lock the same rows.
CREATE OR REPLACE FUNCTION public.finalize_ship_repairs(_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;

  -- 1) Rescue: any destroyed ship missing a repair timer -> assign one based on level.
  UPDATE public.ships_owned AS so
     SET repair_ends_at = so.destroyed_at
       + make_interval(secs =>
           ROUND(60 + (LEAST(30, GREATEST(1, COALESCE(so.template_id, 1))) - 1)
                      * (14400 - 60) / 29.0)::int)
   WHERE so.user_id = _user
     AND so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NULL;

  -- 2) Fully restore every ship whose repair timer has ended.
  UPDATE public.ships_owned
     SET hp = COALESCE(max_hp, 100),
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE user_id = _user
     AND repair_ends_at IS NOT NULL
     AND repair_ends_at <= now();

  -- 3) Gradually heal still-repairing destroyed ships.
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
   WHERE so.user_id = _user
     AND so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NOT NULL
     AND so.repair_ends_at > now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_ship_repairs(uuid) TO authenticated, service_role;
