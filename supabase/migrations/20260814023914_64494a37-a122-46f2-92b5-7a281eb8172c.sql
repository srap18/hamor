-- Hardware-hash based ban check (mirrors is_muted device-wide logic)
CREATE OR REPLACE FUNCTION public.is_hardware_banned(_hash text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _hash IS NULL OR length(trim(_hash)) < 16 THEN false
    ELSE EXISTS (
      SELECT 1
        FROM public.device_identity_users m
        JOIN public.bans b ON b.user_id = m.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
       WHERE m.hardware_hash = trim(_hash)
         AND m.confidence >= 95
         AND NOT public.is_admin(m.user_id)
    ) OR EXISTS (
      SELECT 1
        FROM public.device_slots s
        JOIN public.bans b ON b.user_id = s.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
       WHERE s.hardware_hash = trim(_hash)
         AND NOT public.is_admin(s.user_id)
    )
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.is_hardware_banned(text) TO authenticated, service_role;

-- All users sharing the same physical hardware hash as _uid
CREATE OR REPLACE FUNCTION public.device_hardware_linked_users(_uid uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH hashes AS (
    SELECT DISTINCT trim(m.hardware_hash) AS h
      FROM public.device_identity_users m
     WHERE m.user_id = _uid AND m.confidence >= 95
       AND m.hardware_hash IS NOT NULL AND length(trim(m.hardware_hash)) >= 16
    UNION
    SELECT DISTINCT trim(s.hardware_hash)
      FROM public.device_slots s
     WHERE s.user_id = _uid
       AND s.hardware_hash IS NOT NULL AND length(trim(s.hardware_hash)) >= 16
  )
  SELECT DISTINCT u FROM (
    SELECT m.user_id AS u FROM public.device_identity_users m
      JOIN hashes ON trim(m.hardware_hash) = hashes.h
     WHERE m.confidence >= 95
    UNION
    SELECT s.user_id FROM public.device_slots s
      JOIN hashes ON trim(s.hardware_hash) = hashes.h
  ) q
  WHERE u <> _uid;
$function$;

GRANT EXECUTE ON FUNCTION public.device_hardware_linked_users(uuid) TO authenticated, service_role;

-- Hard ban: also cover hardware-hash linked accounts + record identity hashes
CREATE OR REPLACE FUNCTION public.admin_hard_ban(_uid uuid, _reason text DEFAULT ''::text, _admin uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := COALESCE(_admin, auth.uid());
  _email text;
  _devices int := 0;
  _linked int := 0;
  _r record;
  _lemail text;
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
    UNION
    SELECT diu.hardware_hash FROM public.device_identity_users diu
     WHERE diu.user_id = _uid AND diu.confidence >= 95
       AND length(trim(diu.hardware_hash)) >= 32
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

  -- Same physical device: identity match OR same hardware hash (same rule as mutes)
  FOR _r IN
    SELECT l.user_id FROM public.device_identity_linked_users(_uid) l
    UNION
    SELECT h.user_id FROM public.device_hardware_linked_users(_uid) h
  LOOP
    IF _r.user_id = _caller OR public.is_admin(_r.user_id) THEN CONTINUE; END IF;
    UPDATE public.bans SET active = false WHERE user_id = _r.user_id AND active = true;
    INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
    VALUES (_r.user_id, COALESCE(NULLIF(_reason,''),'حظر قوي')||' (نفس الجهاز)', _caller, NULL, true);
    UPDATE public.profiles
       SET active_session_id = 'banned-'||extract(epoch from now())::bigint::text
     WHERE id = _r.user_id;
    SELECT lower(email) INTO _lemail FROM auth.users WHERE id = _r.user_id;
    IF _lemail IS NOT NULL THEN
      INSERT INTO public.banned_emails(email, reason, banned_by)
      VALUES (_lemail, COALESCE(NULLIF(_reason,''),'حظر قوي')||' (نفس الجهاز)', _caller)
      ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
    END IF;
    _linked := _linked + 1;
  END LOOP;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_caller, 'admin_hard_ban', _uid,
    jsonb_build_object('reason', COALESCE(_reason,''), 'email', _email,
                       'devices_banned', _devices, 'linked_users_banned', _linked));

  RETURN jsonb_build_object('ok', true, 'email', _email, 'devices', _devices, 'linked', _linked, 'ips', 0);
END;
$function$;