CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ends timestamptz;
BEGIN
  PERFORM public.assert_email_verified();
  SELECT ends_at INTO _ends FROM public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id);
  RETURN jsonb_build_object('ends_at', _ends);
END;
$function$;