
-- Require ALL of the attacker's non-storage ships to be fishing at sea
-- (none destroyed, none idle, none stealing). At least one ship must exist.
CREATE OR REPLACE FUNCTION public.has_fishing_ship(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _user_id AND in_storage = false
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _user_id
       AND in_storage = false
       AND (
         destroyed_at IS NOT NULL
         OR at_sea = false
         OR fishing_started_at IS NULL
         OR stealing_target_user_id IS NOT NULL
       )
  )
$function$;
