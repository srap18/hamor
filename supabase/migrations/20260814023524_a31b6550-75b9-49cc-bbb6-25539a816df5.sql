CREATE OR REPLACE FUNCTION public.pvp_is_immune(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.effective_market_level(_user_id), 1) < 15;
$function$;

CREATE OR REPLACE FUNCTION public.pvp_fleet_count(_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.pvp_eligible_ship_count(_user_id, 15);
$function$;