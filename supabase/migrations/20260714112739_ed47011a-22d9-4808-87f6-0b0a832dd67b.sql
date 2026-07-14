CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_email_verified();
  PERFORM public.send_support_impl(_recipient_id, _ship_id, _kind, _crew_id);
  RETURN jsonb_build_object('ok', true);
END;
$function$;