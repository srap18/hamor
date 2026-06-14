CREATE OR REPLACE FUNCTION public.has_pvp_fleet(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT COUNT(*) FROM public.ships_owned
      WHERE user_id = _user_id
        AND in_storage = false
        AND destroyed_at IS NULL
        AND COALESCE(template_id, 0) >= 6), 0) >= 3
$function$;