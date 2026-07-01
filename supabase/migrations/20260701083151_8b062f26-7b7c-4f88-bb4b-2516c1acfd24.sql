CREATE OR REPLACE FUNCTION public.drop_my_protection()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL,
         shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = auth.uid();
END;
$function$;