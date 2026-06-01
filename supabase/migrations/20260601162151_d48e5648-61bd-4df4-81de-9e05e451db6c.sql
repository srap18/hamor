CREATE OR REPLACE FUNCTION public.register_device(_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _device_id IS NULL OR length(_device_id) < 8 THEN RAISE EXCEPTION 'invalid device id'; END IF;

  -- Device binding disabled: just record latest device for this user without blocking.
  INSERT INTO public.device_accounts(device_id, user_id)
    VALUES (_device_id, v_uid)
    ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END; $function$;