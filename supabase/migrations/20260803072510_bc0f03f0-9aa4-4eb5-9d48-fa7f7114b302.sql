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
    SELECT da.device_id
      FROM public.device_accounts da
     WHERE da.user_id = _uid
    UNION
    SELECT dh.device_id
      FROM public.device_history dh
     WHERE dh.user_id = _uid
       AND length(trim(dh.device_id)) >= 32
    UNION
    SELECT ds.hardware_hash
      FROM public.device_slots ds
     WHERE ds.user_id = _uid
       AND length(trim(ds.hardware_hash)) >= 32
  ), ins AS (
    INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
    SELECT trim(device_id), _uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller
      FROM trusted_ids
     WHERE device_id IS NOT NULL
       AND lower(trim(device_id)) NOT IN ('unknown','null','undefined','none','default')
       AND trim(device_id) !~ '^([[:alnum:]])\1+$'
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

CREATE OR REPLACE FUNCTION public.device_slot_check(_hardware_hash text, _user_id uuid, _email text, _fingerprint_version integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rl jsonb;
  lock_key bigint;
  slot_a public.device_slots;
  slot_b public.device_slots;
  taken_count integer;
  now_ts timestamptz := now();
BEGIN
  IF _user_id IS NOT NULL AND public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'admin_bypass');
  END IF;

  IF _hardware_hash IS NULL OR length(_hardware_hash) < 8 THEN
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'fingerprint_required');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.banned_devices bd
     WHERE bd.device_id = _hardware_hash
  ) THEN
    INSERT INTO public.device_slot_audit(hardware_hash, user_id, event, details)
    VALUES (_hardware_hash, _user_id, 'login_blocked_banned_device', jsonb_build_object('email', _email));
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'device_banned');
  END IF;

  rl := public.device_rate_limit_check(_hardware_hash);
  IF NOT COALESCE((rl->>'allowed')::boolean, true) THEN
    RETURN jsonb_build_object(
      'action', 'rate_limited',
      'reason', 'too_many_attempts',
      'blocked_until', rl->>'blocked_until',
      'retry_after_seconds', (rl->>'retry_after_seconds')::int
    );
  END IF;

  lock_key := ('x' || substr(md5(_hardware_hash), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT * INTO slot_a FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 1 FOR UPDATE;
  SELECT * INTO slot_b FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 2 FOR UPDATE;

  taken_count := (CASE WHEN slot_a.user_id IS NOT NULL THEN 1 ELSE 0 END)
               + (CASE WHEN slot_b.user_id IS NOT NULL THEN 1 ELSE 0 END);

  IF _user_id IS NOT NULL AND (
       slot_a.user_id = _user_id OR slot_b.user_id = _user_id
     ) THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'existing_slot', 'taken', taken_count);
  END IF;

  IF taken_count < 2 THEN
    RETURN jsonb_build_object('action', 'warn_new_slot', 'reason', 'slot_available', 'taken', taken_count);
  END IF;

  IF (slot_a.locked_until IS NOT NULL AND slot_a.locked_until > now_ts)
     OR (slot_b.locked_until IS NOT NULL AND slot_b.locked_until > now_ts) THEN
    INSERT INTO public.device_slot_audit(hardware_hash, user_id, event, details)
    VALUES (_hardware_hash, _user_id, 'login_blocked_third_account',
            jsonb_build_object('email', _email, 'slot_a_locked_until', slot_a.locked_until,
                               'slot_b_locked_until', slot_b.locked_until));

    RETURN jsonb_build_object('action', 'blocked', 'reason', 'device_full',
                              'slot_a_locked_until', slot_a.locked_until,
                              'slot_b_locked_until', slot_b.locked_until);
  END IF;

  RETURN jsonb_build_object('action', 'warn_new_slot', 'reason', 'lock_expired', 'taken', taken_count);
END;
$function$;

INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
SELECT x.device_id,
       '76073b99-96df-4574-9ddc-70a586113fe9'::uuid,
       'تصحيح الحظر الشامل: بصمة جهاز متكررة الإنشاء',
       (SELECT banned_by FROM public.bans WHERE user_id='76073b99-96df-4574-9ddc-70a586113fe9'::uuid AND active=true ORDER BY banned_at DESC LIMIT 1)
FROM (
  SELECT device_id FROM public.device_history WHERE user_id='76073b99-96df-4574-9ddc-70a586113fe9'::uuid
  UNION
  SELECT hardware_hash FROM public.device_slots WHERE user_id='76073b99-96df-4574-9ddc-70a586113fe9'::uuid
  UNION
  SELECT device_id FROM public.device_accounts WHERE user_id='76073b99-96df-4574-9ddc-70a586113fe9'::uuid
) x
WHERE x.device_id IS NOT NULL AND length(trim(x.device_id)) >= 32
ON CONFLICT (device_id) DO UPDATE
SET user_id=EXCLUDED.user_id, reason=EXCLUDED.reason, banned_by=COALESCE(EXCLUDED.banned_by, public.banned_devices.banned_by);