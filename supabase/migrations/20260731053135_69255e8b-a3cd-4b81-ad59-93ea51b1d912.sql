CREATE OR REPLACE FUNCTION public.regen_damaged_ships(_user uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Rescue legacy damaged-alive rows and establish an exact server timeline.
  UPDATE public.ships_owned AS so
     SET last_damaged_at = COALESCE(so.last_damaged_at, clock_timestamp()),
         repair_started_hp = COALESCE(so.repair_started_hp, GREATEST(0, COALESCE(so.hp, 0))),
         passive_repair_ends_at = clock_timestamp()
           + make_interval(secs => GREATEST(
               1,
               CEIL(
                 public._ship_repair_seconds(so.template_id)::numeric
                 * GREATEST(0, COALESCE(so.max_hp, 100) - COALESCE(so.hp, 0))::numeric
                 / GREATEST(1, COALESCE(so.max_hp, 100))::numeric
               )::integer
             ))
   WHERE (_user IS NULL OR so.user_id = _user)
     AND so.destroyed_at IS NULL
     AND COALESCE(so.hp, 0) > 0
     AND COALESCE(so.hp, 0) < GREATEST(1, COALESCE(so.max_hp, 100))
     AND (so.repair_started_hp IS NULL OR so.passive_repair_ends_at IS NULL);

  -- Complete elapsed passive repairs exactly at their authoritative end time.
  UPDATE public.ships_owned AS so
     SET hp = GREATEST(1, COALESCE(so.max_hp, 100)),
         last_damaged_at = NULL,
         repair_started_hp = NULL,
         passive_repair_ends_at = NULL
   WHERE (_user IS NULL OR so.user_id = _user)
     AND so.destroyed_at IS NULL
     AND so.passive_repair_ends_at IS NOT NULL
     AND so.passive_repair_ends_at <= clock_timestamp();

  -- Derive current HP from the immutable start snapshot and server timestamps.
  -- This avoids cumulative rounding drift and makes the final result exact.
  UPDATE public.ships_owned AS so
     SET hp = LEAST(
       GREATEST(1, COALESCE(so.max_hp, 100)),
       GREATEST(
         COALESCE(so.hp, 0),
         COALESCE(so.repair_started_hp, so.hp, 0)
         + FLOOR(
             (GREATEST(1, COALESCE(so.max_hp, 100)) - COALESCE(so.repair_started_hp, so.hp, 0))::numeric
             * EXTRACT(EPOCH FROM (clock_timestamp() - so.last_damaged_at))::numeric
             / NULLIF(EXTRACT(EPOCH FROM (so.passive_repair_ends_at - so.last_damaged_at))::numeric, 0)
           )::integer
       )
     )
   WHERE (_user IS NULL OR so.user_id = _user)
     AND so.destroyed_at IS NULL
     AND so.last_damaged_at IS NOT NULL
     AND so.repair_started_hp IS NOT NULL
     AND so.passive_repair_ends_at IS NOT NULL
     AND so.passive_repair_ends_at > clock_timestamp()
     AND COALESCE(so.hp, 0) < GREATEST(1, COALESCE(so.max_hp, 100))
     -- No-op write guard: skip rows whose computed HP equals the stored HP.
     AND LEAST(
           GREATEST(1, COALESCE(so.max_hp, 100)),
           GREATEST(
             COALESCE(so.hp, 0),
             COALESCE(so.repair_started_hp, so.hp, 0)
             + FLOOR(
                 (GREATEST(1, COALESCE(so.max_hp, 100)) - COALESCE(so.repair_started_hp, so.hp, 0))::numeric
                 * EXTRACT(EPOCH FROM (clock_timestamp() - so.last_damaged_at))::numeric
                 / NULLIF(EXTRACT(EPOCH FROM (so.passive_repair_ends_at - so.last_damaged_at))::numeric, 0)
               )::integer
           )
         ) IS DISTINCT FROM so.hp;
END
$function$;

CREATE OR REPLACE FUNCTION public.finalize_ship_repairs(_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user IS NULL THEN RETURN; END IF;

  UPDATE public.ships_owned AS so
     SET repair_ends_at = so.destroyed_at
       + make_interval(secs => public._ship_repair_seconds(so.template_id))
   WHERE so.user_id = _user
     AND so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NULL;

  UPDATE public.ships_owned
     SET hp = COALESCE(max_hp, 100),
         destroyed_at = NULL,
         repair_ends_at = NULL,
         last_damaged_at = NULL,
         repair_started_hp = NULL,
         passive_repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE user_id = _user
     AND repair_ends_at IS NOT NULL
     AND repair_ends_at <= clock_timestamp();

  UPDATE public.ships_owned AS so
     SET hp = LEAST(
                COALESCE(so.max_hp, 100),
                GREATEST(
                  COALESCE(so.hp, 0),
                  FLOOR(
                    COALESCE(so.max_hp, 100)::numeric
                    * EXTRACT(EPOCH FROM (clock_timestamp() - so.destroyed_at))::numeric
                    / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
                  )::integer
                )
              )
   WHERE so.user_id = _user
     AND so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NOT NULL
     AND so.repair_ends_at > clock_timestamp()
     -- No-op write guard: skip rows whose computed HP equals the stored HP.
     AND LEAST(
           COALESCE(so.max_hp, 100),
           GREATEST(
             COALESCE(so.hp, 0),
             FLOOR(
               COALESCE(so.max_hp, 100)::numeric
               * EXTRACT(EPOCH FROM (clock_timestamp() - so.destroyed_at))::numeric
               / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
             )::integer
           )
         ) IS DISTINCT FROM so.hp;

  PERFORM public.regen_damaged_ships(_user);
END
$function$;

CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NOT NULL THEN
    PERFORM public.finalize_ship_repairs(_uid);
    RETURN;
  END IF;

  UPDATE public.ships_owned AS so
     SET repair_ends_at = so.destroyed_at
       + make_interval(secs => public._ship_repair_seconds(so.template_id))
   WHERE so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NULL;

  UPDATE public.ships_owned
     SET hp = COALESCE(max_hp, 100),
         destroyed_at = NULL,
         repair_ends_at = NULL,
         last_damaged_at = NULL,
         repair_started_hp = NULL,
         passive_repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE repair_ends_at IS NOT NULL
     AND repair_ends_at <= clock_timestamp();

  UPDATE public.ships_owned AS so
     SET hp = LEAST(
                COALESCE(so.max_hp, 100),
                GREATEST(
                  COALESCE(so.hp, 0),
                  FLOOR(
                    COALESCE(so.max_hp, 100)::numeric
                    * EXTRACT(EPOCH FROM (clock_timestamp() - so.destroyed_at))::numeric
                    / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
                  )::integer
                )
              )
   WHERE so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NOT NULL
     AND so.repair_ends_at > clock_timestamp()
     -- No-op write guard: skip rows whose computed HP equals the stored HP.
     AND LEAST(
           COALESCE(so.max_hp, 100),
           GREATEST(
             COALESCE(so.hp, 0),
             FLOOR(
               COALESCE(so.max_hp, 100)::numeric
               * EXTRACT(EPOCH FROM (clock_timestamp() - so.destroyed_at))::numeric
               / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
             )::integer
           )
         ) IS DISTINCT FROM so.hp;

  PERFORM public.regen_damaged_ships(NULL);
END
$function$;