CREATE OR REPLACE FUNCTION public.has_fishing_ship(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Attacker must have AT LEAST 1 active ship currently fishing
  -- (not destroyed and not on a steal mission). Destroyed ships in the
  -- fleet do not block attacking as long as one ship is fishing.
  SELECT EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _user_id
       AND at_sea = true
       AND fishing_started_at IS NOT NULL
       AND destroyed_at IS NULL
       AND stealing_target_user_id IS NULL
  )
$function$;