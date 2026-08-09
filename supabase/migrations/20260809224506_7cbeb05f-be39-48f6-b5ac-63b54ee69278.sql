CREATE OR REPLACE FUNCTION public.launch_kraken_impl(_target_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NULL;
END;
$function$;