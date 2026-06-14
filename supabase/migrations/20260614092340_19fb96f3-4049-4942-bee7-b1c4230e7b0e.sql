CREATE OR REPLACE FUNCTION public.touch_session(_device_id text, _ip text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  UPDATE public.profiles
     SET online_at = now()
   WHERE id = v_uid;

  IF _ip IS NOT NULL AND length(_ip) BETWEEN 3 AND 64 THEN
    INSERT INTO public.user_ips(user_id, ip, first_seen, last_seen, hits)
    VALUES (v_uid, _ip, now(), now(), 1)
    ON CONFLICT (user_id, ip) DO UPDATE
      SET last_seen = now(), hits = public.user_ips.hits + 1;
  END IF;

  IF _device_id IS NOT NULL AND length(_device_id) BETWEEN 8 AND 160 THEN
    INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
    VALUES (_device_id, v_uid, now(), now(), 1)
    ON CONFLICT (device_id, user_id) DO UPDATE
      SET last_seen = now(), hits = public.device_history.hits + 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_session(text, text) TO authenticated, service_role;