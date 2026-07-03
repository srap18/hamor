CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Fully restore every ship whose repair timer has ended, even if destroyed_at
  -- was already cleared by an older repair path while repair_ends_at remained.
  UPDATE public.ships_owned
     SET hp = COALESCE(max_hp, 100),
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE repair_ends_at IS NOT NULL
     AND repair_ends_at <= now();

  -- Gradually heal still-repairing destroyed ships: hp = max_hp * elapsed/total.
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
$$;

GRANT EXECUTE ON FUNCTION public.finalize_ship_repairs() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._ship_repair_ratio(_destroyed_at timestamp with time zone, _repair_ends_at timestamp with time zone)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _destroyed_at IS NULL OR _repair_ends_at IS NULL THEN 1::numeric
    WHEN now() >= _repair_ends_at THEN 1::numeric
    WHEN _repair_ends_at <= _destroyed_at THEN 1::numeric
    ELSE GREATEST(0::numeric, LEAST(1::numeric,
      EXTRACT(EPOCH FROM (now() - _destroyed_at))::numeric
      / NULLIF(EXTRACT(EPOCH FROM (_repair_ends_at - _destroyed_at))::numeric, 0)
    ))
  END
$$;

SELECT public.finalize_ship_repairs();