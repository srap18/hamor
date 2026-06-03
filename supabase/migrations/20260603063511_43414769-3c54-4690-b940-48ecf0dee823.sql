CREATE OR REPLACE FUNCTION public.has_fishing_ship(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Attacker must have AT LEAST 3 active ships currently fishing
  -- (mandatory: all three fleet ships in fishing mode before any attack).
  SELECT (
    SELECT COUNT(*) FROM public.ships_owned
     WHERE user_id = _user_id
       AND at_sea = true
       AND fishing_started_at IS NOT NULL
       AND destroyed_at IS NULL
       AND stealing_target_user_id IS NULL
  ) >= 3
$function$;