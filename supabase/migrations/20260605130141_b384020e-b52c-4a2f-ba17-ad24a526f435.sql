CREATE OR REPLACE FUNCTION public.has_fishing_ship(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Attacker cannot have ANY destroyed ship in the fleet,
  -- AND must have at least one ship currently fishing at sea.
  SELECT
    NOT EXISTS (
      SELECT 1 FROM public.ships_owned
       WHERE user_id = _user_id
         AND in_storage = false
         AND destroyed_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.ships_owned
       WHERE user_id = _user_id
         AND at_sea = true
         AND fishing_started_at IS NOT NULL
         AND destroyed_at IS NULL
         AND stealing_target_user_id IS NULL
    )
$function$;