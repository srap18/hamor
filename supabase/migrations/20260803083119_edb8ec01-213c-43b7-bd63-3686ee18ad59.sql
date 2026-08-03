
CREATE TABLE IF NOT EXISTS public.device_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL,
  noise_key text,
  native_id text,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_generic boolean NOT NULL DEFAULT false,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.device_identities TO service_role;
ALTER TABLE public.device_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "device_identities service only" ON public.device_identities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS device_identities_native_uidx
  ON public.device_identities(native_id) WHERE native_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS device_identities_keys_uidx
  ON public.device_identities(stable_key, noise_key) WHERE native_id IS NULL;
CREATE INDEX IF NOT EXISTS device_identities_stable_idx ON public.device_identities(stable_key);

CREATE TABLE IF NOT EXISTS public.device_identity_users (
  identity_id uuid NOT NULL REFERENCES public.device_identities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  confidence smallint NOT NULL DEFAULT 0,
  hardware_hash text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, user_id)
);

GRANT ALL ON public.device_identity_users TO service_role;
ALTER TABLE public.device_identity_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "device_identity_users service only" ON public.device_identity_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS device_identity_users_user_idx ON public.device_identity_users(user_id);

-- Mark an identity as generic (untrusted) once too many distinct accounts use it.
CREATE OR REPLACE FUNCTION public.device_identity_mark_generic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.device_identity_users WHERE identity_id = NEW.identity_id;
  IF _n > 6 THEN
    UPDATE public.device_identities SET is_generic = true WHERE id = NEW.identity_id AND is_generic = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_identity_users_generic_trg ON public.device_identity_users;
CREATE TRIGGER device_identity_users_generic_trg
AFTER INSERT ON public.device_identity_users
FOR EACH ROW EXECUTE FUNCTION public.device_identity_mark_generic();

-- Accounts confirmed (>=95 confidence) to run on the same physical device.
CREATE OR REPLACE FUNCTION public.device_identity_linked_users(_uid uuid)
RETURNS TABLE(user_id uuid, confidence smallint, identity_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (o.user_id) o.user_id, o.confidence, o.identity_id
    FROM public.device_identity_users m
    JOIN public.device_identities di ON di.id = m.identity_id AND di.is_generic = false
    JOIN public.device_identity_users o ON o.identity_id = m.identity_id
   WHERE m.user_id = _uid
     AND m.confidence >= 95
     AND o.confidence >= 95
     AND o.user_id <> _uid
   ORDER BY o.user_id, o.confidence DESC;
$$;

-- Hard ban now also bans accounts confirmed on the same physical device.
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

  -- Same physical device (confirmed, non-generic identity) => ban too.
  FOR _r IN SELECT l.user_id FROM public.device_identity_linked_users(_uid) l LOOP
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

-- Is any account confirmed on this identity banned?
CREATE OR REPLACE FUNCTION public.device_identity_is_banned(_identity uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.device_identities di
      JOIN public.device_identity_users m ON m.identity_id = di.id AND m.confidence >= 95
      JOIN public.bans b ON b.user_id = m.user_id AND b.active = true
                        AND (b.expires_at IS NULL OR b.expires_at > now())
     WHERE di.id = _identity AND di.is_generic = false
  );
$$;
