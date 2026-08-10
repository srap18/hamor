CREATE OR REPLACE FUNCTION public.pvp_is_immune(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT
      CASE
        WHEN COALESCE(public.effective_market_level(p.id), 1) < 15 THEN true
        WHEN EXISTS (
          SELECT 1 FROM public.ships_owned s
          WHERE s.user_id = p.id AND COALESCE(s.template_id, 0) >= 15
        ) THEN false
        ELSE (p.pvp_immunity_lifted_at IS NULL)
      END
    FROM public.profiles p WHERE p.id = _user_id
  ), true);
$function$;

UPDATE public.profiles p
   SET pvp_immunity_lifted_at = now()
 WHERE p.pvp_immunity_lifted_at IS NULL
   AND COALESCE(public.effective_market_level(p.id), 1) >= 15
   AND EXISTS (
     SELECT 1 FROM public.ships_owned s
     WHERE s.user_id = p.id AND COALESCE(s.template_id, 0) >= 15
   );