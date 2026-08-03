
CREATE OR REPLACE FUNCTION public.device_id_is_collision(_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    SELECT count(DISTINCT user_id) FROM public.device_history WHERE device_id = _device_id
  ) > 5;
$$;

CREATE OR REPLACE FUNCTION public.is_device_banned(_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.banned_devices bd
     WHERE bd.device_id = _device_id
       AND NOT public.device_id_is_collision(bd.device_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_hard_ban(_uid uuid, _reason text DEFAULT ''::text, _admin uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _caller uuid := COALESCE(_admin, auth.uid());
  _email text;
  _devices int := 0;
BEGIN
  IF _caller IS NULL OR NOT public.is_admin(_caller) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _uid IS NULL THEN RAISE EXCEPTION 'missing user'; END IF;
  IF _uid = _caller THEN RAISE EXCEPTION 'cannot ban self'; END IF;

  SELECT lower(email) INTO _email FROM auth.users WHERE id = _uid;

  IF _email IS NOT NULL THEN
    INSERT INTO public.banned_emails(email, reason, banned_by)
    VALUES (_email, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller)
    ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
  END IF;

  WITH trusted_ids AS (
    SELECT da.device_id FROM public.device_accounts da WHERE da.user_id = _uid
    UNION
    SELECT dh.device_id FROM public.device_history dh
     WHERE dh.user_id = _uid AND length(trim(dh.device_id)) >= 32
    UNION
    SELECT ds.hardware_hash FROM public.device_slots ds
     WHERE ds.user_id = _uid AND length(trim(ds.hardware_hash)) >= 32
  ), ins AS (
    INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
    SELECT trim(t.device_id), _uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller
      FROM trusted_ids t
     WHERE t.device_id IS NOT NULL
       AND lower(trim(t.device_id)) NOT IN ('unknown','null','undefined','none','default')
       AND trim(t.device_id) !~ '^([[:alnum:]])\1+$'
       AND NOT public.device_id_is_collision(trim(t.device_id))
    ON CONFLICT (device_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          reason = EXCLUDED.reason,
          banned_by = EXCLUDED.banned_by
    RETURNING 1
  ) SELECT count(*) INTO _devices FROM ins;

  UPDATE public.bans SET active = false WHERE user_id = _uid AND active = true;
  INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
  VALUES (_uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller, NULL, true);

  UPDATE public.profiles
     SET active_session_id = 'banned-'||extract(epoch from now())::bigint::text
   WHERE id = _uid;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_caller, 'admin_hard_ban', _uid,
    jsonb_build_object('reason', COALESCE(_reason,''), 'email', _email, 'devices_banned', _devices));

  RETURN jsonb_build_object('ok', true, 'email', _email, 'devices', _devices, 'ips', 0);
END;
$function$;
