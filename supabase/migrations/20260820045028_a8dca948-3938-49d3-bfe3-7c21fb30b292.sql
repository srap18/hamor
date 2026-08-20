-- 1) Residency: an account "lives" on a device only with a strong link.
CREATE OR REPLACE FUNCTION public.device_resident(_uid uuid, _device text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _uid IS NULL OR _device IS NULL OR length(trim(_device)) < 8 THEN false
    ELSE (
      EXISTS (SELECT 1 FROM public.device_slots s
               WHERE s.user_id = _uid AND trim(s.hardware_hash) = trim(_device))
      OR EXISTS (SELECT 1 FROM public.device_accounts a
                  WHERE a.user_id = _uid
                    AND (trim(a.device_id) = trim(_device)
                         OR trim(COALESCE(a.hardware_hash,'')) = trim(_device)))
      OR EXISTS (SELECT 1 FROM public.device_history h
                  WHERE h.user_id = _uid AND trim(h.device_id) = trim(_device)
                    AND (COALESCE(h.hits,0) >= 3
                         OR h.last_seen - h.first_seen >= interval '24 hours'))
      OR EXISTS (SELECT 1 FROM public.device_identity_users m
                  WHERE m.user_id = _uid
                    AND trim(COALESCE(m.hardware_hash,'')) = trim(_device)
                    AND m.confidence >= 95
                    AND m.last_seen - m.first_seen >= interval '24 hours')
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.device_shared_resident(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT DISTINCT trim(x.h) AS h FROM (
      SELECT device_id AS h FROM public.device_history WHERE user_id = _a
      UNION SELECT hardware_hash FROM public.device_slots WHERE user_id = _a
      UNION SELECT device_id FROM public.device_accounts WHERE user_id = _a
      UNION SELECT hardware_hash FROM public.device_identity_users
             WHERE user_id = _a AND confidence >= 95
    ) x WHERE x.h IS NOT NULL AND length(trim(x.h)) >= 8
  )
  SELECT EXISTS (
    SELECT 1 FROM d
     WHERE public.device_resident(_a, d.h) AND public.device_resident(_b, d.h)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.device_resident(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.device_shared_resident(uuid, uuid) TO authenticated, service_role;

-- 2) Device-wide mute only reaches devices the muted user actually lives on.
CREATE OR REPLACE FUNCTION public.sync_chat_mute_devices_ips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.active = true THEN
    INSERT INTO public.chat_mute_devices(device_id, mute_id, source_user_id, reason, active, expires_at)
    SELECT DISTINCT da.device_id, NEW.id, NEW.user_id, NEW.reason, true, NEW.expires_at
    FROM public.device_accounts da
    WHERE da.user_id = NEW.user_id AND da.device_id IS NOT NULL AND length(da.device_id) > 0
      AND public.device_resident(NEW.user_id, da.device_id);

    INSERT INTO public.chat_mute_devices(device_id, mute_id, source_user_id, reason, active, expires_at)
    SELECT DISTINCT dh.device_id, NEW.id, NEW.user_id, NEW.reason, true, NEW.expires_at
    FROM public.device_history dh
    WHERE dh.user_id = NEW.user_id AND dh.device_id IS NOT NULL AND length(dh.device_id) > 0
      AND public.device_resident(NEW.user_id, dh.device_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_mute_devices cmd
        WHERE cmd.mute_id = NEW.id AND cmd.device_id = dh.device_id
      );

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.active = false AND OLD.active = true THEN
      UPDATE public.chat_mute_devices SET active = false WHERE mute_id = NEW.id;
    ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      UPDATE public.chat_mute_devices SET expires_at = NEW.expires_at WHERE mute_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Hardware/identity ban checks require the banned account to live there.
CREATE OR REPLACE FUNCTION public.is_hardware_banned(_hash text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _hash IS NULL OR length(trim(_hash)) < 16 THEN false
    WHEN public.device_hash_collision(trim(_hash)) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.device_identity_users m
        JOIN public.bans b ON b.user_id = m.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
                          AND COALESCE(b.scope, 'both') IN ('device', 'both')
       WHERE m.hardware_hash = trim(_hash) AND m.confidence >= 95
         AND NOT public.is_admin(m.user_id)
         AND public.device_resident(m.user_id, trim(_hash))
    ) OR EXISTS (
      SELECT 1 FROM public.device_slots s
        JOIN public.bans b ON b.user_id = s.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
                          AND COALESCE(b.scope, 'both') IN ('device', 'both')
       WHERE s.hardware_hash = trim(_hash) AND NOT public.is_admin(s.user_id)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.device_identity_is_banned(_identity uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _identity IS NULL OR public.device_identity_collision(_identity) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.device_identity_users m
        JOIN public.bans b ON b.user_id = m.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
                          AND COALESCE(b.scope, 'both') IN ('device', 'both')
       WHERE m.identity_id = _identity AND m.confidence >= 95
         AND NOT public.is_admin(m.user_id)
         AND (
           m.hardware_hash IS NULL
           OR public.device_resident(m.user_id, m.hardware_hash)
           OR m.last_seen - m.first_seen >= interval '24 hours'
         )
    )
  END;
$function$;

-- 4) Auto device-ban on banned-account login only for resident accounts.
CREATE OR REPLACE FUNCTION public.register_device(_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_user uuid;
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _device_id IS NULL OR length(_device_id) < 8 OR length(_device_id) > 160 THEN RAISE EXCEPTION 'invalid device id'; END IF;

  v_is_admin := public.is_admin(v_uid);

  IF v_is_admin THEN
    INSERT INTO public.device_accounts(device_id, user_id)
      VALUES (_device_id, v_uid)
      ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'admin', true);
  END IF;

  IF public.is_banned(v_uid) THEN
    IF public.device_resident(v_uid, _device_id) THEN
      INSERT INTO public.banned_devices(device_id, user_id, reason)
        VALUES (_device_id, v_uid, 'محاولة دخول لحساب محظور')
        ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id, reason = EXCLUDED.reason;
    END IF;
    RAISE EXCEPTION 'account banned';
  END IF;

  IF EXISTS (SELECT 1 FROM public.banned_devices WHERE device_id = _device_id) THEN
    RAISE EXCEPTION 'device banned permanently';
  END IF;

  SELECT user_id INTO v_existing_user
  FROM public.device_accounts
  WHERE device_id = _device_id;

  IF v_existing_user IS NOT NULL AND v_existing_user <> v_uid THEN
    IF public.is_admin(v_existing_user) THEN
      UPDATE public.device_accounts SET user_id = v_uid, updated_at = now() WHERE device_id = _device_id;
      RETURN jsonb_build_object('ok', true);
    END IF;

    IF public.is_banned(v_existing_user) AND public.device_resident(v_existing_user, _device_id) THEN
      INSERT INTO public.banned_devices(device_id, user_id, reason)
      VALUES (_device_id, v_existing_user, 'جهاز مرتبط بحساب محظور')
      ON CONFLICT (device_id) DO NOTHING;
      RAISE EXCEPTION 'device banned permanently';
    END IF;

    RAISE EXCEPTION 'device already bound to another account';
  END IF;

  IF EXISTS (SELECT 1 FROM public.device_accounts WHERE user_id = v_uid AND device_id <> _device_id) THEN
    RAISE EXCEPTION 'account already bound to another device';
  END IF;

  INSERT INTO public.device_accounts(device_id, user_id)
    VALUES (_device_id, v_uid)
    ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 5) Hard ban: only resident devices, and peers must share a resident device.
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
  _suspected int := 0;
  _r record;
  _lemail text;
  _sc jsonb;
  _st jsonb;
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
       AND public.device_resident(_uid, trim(t.device_id))
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

  FOR _r IN SELECT c.other_id AS user_id FROM public.device_peer_candidates(_uid) c
  LOOP
    IF _r.user_id = _caller OR public.is_admin(_r.user_id) THEN CONTINUE; END IF;

    _sc := public.device_match_score(_uid, _r.user_id);
    _st := public.device_strong_link(_uid, _r.user_id);

    IF COALESCE((_st->>'strong')::int,0) >= 1 AND COALESCE((_sc->>'score')::int,0) >= 80
       AND public.device_shared_resident(_uid, _r.user_id) THEN
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
    ELSIF COALESCE((_sc->>'score')::int,0) >= 60 THEN
      INSERT INTO public.suspected_device_matches(source_user_id, suspect_user_id, score, signals, detail, reason)
      VALUES (_uid, _r.user_id, COALESCE((_sc->>'score')::int,0), COALESCE((_sc->>'signals')::int,0),
              jsonb_build_object('score', _sc, 'strong', _st), COALESCE(NULLIF(_reason,''),'حظر قوي'))
      ON CONFLICT (source_user_id, suspect_user_id) DO UPDATE
        SET score = EXCLUDED.score, signals = EXCLUDED.signals, detail = EXCLUDED.detail,
            updated_at = now()
        WHERE public.suspected_device_matches.status = 'pending';
      _suspected := _suspected + 1;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_caller, 'admin_hard_ban', _uid,
    jsonb_build_object('reason', COALESCE(_reason,''), 'email', _email,
                       'devices_banned', _devices, 'linked_users_banned', _linked,
                       'suspected_queued', _suspected));

  RETURN jsonb_build_object('ok', true, 'email', _email, 'devices', _devices,
                            'linked', _linked, 'suspected', _suspected, 'ips', 0);
END;
$function$;