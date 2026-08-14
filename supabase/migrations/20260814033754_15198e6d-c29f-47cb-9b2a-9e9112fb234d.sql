-- 1) Install identity (server-issued, HttpOnly cookie / native secure store)
CREATE TABLE IF NOT EXISTS public.device_install_ids (
  install_id text NOT NULL,
  user_id uuid NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (install_id, user_id)
);
GRANT SELECT ON public.device_install_ids TO authenticated;
GRANT ALL ON public.device_install_ids TO service_role;
ALTER TABLE public.device_install_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own or admin read install ids" ON public.device_install_ids;
CREATE POLICY "own or admin read install ids" ON public.device_install_ids
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS device_install_ids_user_idx ON public.device_install_ids(user_id);

-- 2) Trust guards for strong identity signals
CREATE OR REPLACE FUNCTION public.device_install_collision(_install text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _install IS NULL OR length(trim(_install)) < 24
      OR (SELECT count(DISTINCT user_id) FROM public.device_install_ids WHERE install_id = trim(_install)) > 5;
$$;

CREATE OR REPLACE FUNCTION public.device_native_id_invalid(_native text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _native IS NULL
      OR length(trim(_native)) < 12
      OR lower(trim(_native)) IN (
           'unknown','null','undefined','none','default','9774d56d682e549c',
           '00000000-0000-0000-0000-000000000000','0000000000000000','ffffffffffffffff'
         )
      OR trim(_native) ~ '^([[:alnum:]])\1+$'
      OR (SELECT count(DISTINCT m.user_id)
            FROM public.device_identities d
            JOIN public.device_identity_users m ON m.identity_id = d.id
           WHERE d.native_id = trim(_native)) > 5;
$$;

-- 3) Strong identity link between two accounts (proves same physical device)
CREATE OR REPLACE FUNCTION public.device_strong_link(_a uuid, _b uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH
native AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_identity_users ma
      JOIN public.device_identities da ON da.id = ma.identity_id
      JOIN public.device_identities db ON db.native_id = da.native_id
      JOIN public.device_identity_users mb ON mb.identity_id = db.id AND mb.user_id = _b
     WHERE ma.user_id = _a AND ma.confidence >= 95 AND mb.confidence >= 95
       AND NOT public.device_native_id_invalid(da.native_id)
       AND NOT public.device_identity_collision(da.id)
       AND NOT public.device_identity_collision(db.id)
  ) AS hit
),
install AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_install_ids ia
      JOIN public.device_install_ids ib ON ib.install_id = ia.install_id AND ib.user_id = _b
     WHERE ia.user_id = _a AND NOT public.device_install_collision(ia.install_id)
  ) AS hit
),
registry AS (
  SELECT (
    EXISTS (
      SELECT 1 FROM public.device_accounts aa
        JOIN public.device_accounts ab ON ab.device_id = aa.device_id AND ab.user_id = _b
       WHERE aa.user_id = _a AND length(trim(aa.device_id)) >= 16
         AND NOT public.device_id_is_collision(aa.device_id)
    ) OR EXISTS (
      SELECT 1 FROM public.device_slots sa
        JOIN public.device_slots sb ON sb.hardware_hash = sa.hardware_hash AND sb.user_id = _b
       WHERE sa.user_id = _a AND NOT public.device_hash_collision(sa.hardware_hash)
    )
  ) AS hit
)
SELECT jsonb_build_object(
  'strong', (SELECT hit::int FROM native) + (SELECT hit::int FROM install) + (SELECT hit::int FROM registry),
  'native_id', (SELECT hit FROM native),
  'install_id', (SELECT hit FROM install),
  'registry', (SELECT hit FROM registry)
);
$$;

-- 4) Ban propagation decision: strong identity proof REQUIRED
CREATE OR REPLACE FUNCTION public.device_ban_propagates(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((public.device_strong_link(_a, _b) ->> 'strong')::int, 0) >= 1
     AND COALESCE((public.device_match_score(_a, _b) ->> 'score')::int, 0) >= 80;
$$;

-- 5) Suspected matches queue (review instead of auto-ban)
CREATE TABLE IF NOT EXISTS public.suspected_device_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_user_id uuid NOT NULL,
  suspect_user_id uuid NOT NULL,
  score int NOT NULL DEFAULT 0,
  signals int NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_user_id, suspect_user_id)
);
GRANT SELECT ON public.suspected_device_matches TO authenticated;
GRANT ALL ON public.suspected_device_matches TO service_role;
ALTER TABLE public.suspected_device_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read suspected matches" ON public.suspected_device_matches;
CREATE POLICY "admins read suspected matches" ON public.suspected_device_matches
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- 6) Register install identity from the server
CREATE OR REPLACE FUNCTION public.device_install_register(_install_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF _install_id IS NULL OR length(trim(_install_id)) < 24 OR length(trim(_install_id)) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_install_id');
  END IF;
  INSERT INTO public.device_install_ids(install_id, user_id)
  VALUES (trim(_install_id), v_uid)
  ON CONFLICT (install_id, user_id) DO UPDATE SET last_seen = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 7) Hard ban: propagate only with strong proof, otherwise queue for review
CREATE OR REPLACE FUNCTION public.admin_hard_ban(_uid uuid, _reason text DEFAULT ''::text, _admin uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

    IF COALESCE((_st->>'strong')::int,0) >= 1 AND COALESCE((_sc->>'score')::int,0) >= 80 THEN
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
$$;

-- 8) Admin review helpers
CREATE OR REPLACE FUNCTION public.admin_list_suspected_matches(_status text DEFAULT 'pending', _limit int DEFAULT 100)
RETURNS TABLE(id uuid, source_user_id uuid, source_name text, suspect_user_id uuid, suspect_name text,
              score int, signals int, detail jsonb, status text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s.id, s.source_user_id, ps.display_name, s.suspect_user_id, pt.display_name,
         s.score, s.signals, s.detail, s.status, s.created_at
    FROM public.suspected_device_matches s
    LEFT JOIN public.profiles ps ON ps.id = s.source_user_id
    LEFT JOIN public.profiles pt ON pt.id = s.suspect_user_id
   WHERE public.is_admin(auth.uid())
     AND (_status IS NULL OR s.status = _status)
   ORDER BY s.score DESC, s.created_at DESC
   LIMIT GREATEST(1, LEAST(_limit, 500));
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_suspected_match(_id uuid, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _caller uuid := auth.uid(); _row public.suspected_device_matches;
BEGIN
  IF _caller IS NULL OR NOT public.is_admin(_caller) THEN RAISE EXCEPTION 'not admin'; END IF;
  SELECT * INTO _row FROM public.suspected_device_matches WHERE id = _id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;

  IF _action = 'confirm' THEN
    UPDATE public.bans SET active = false WHERE user_id = _row.suspect_user_id AND active = true;
    INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
    VALUES (_row.suspect_user_id, COALESCE(_row.reason,'حظر قوي')||' (تأكيد يدوي - نفس الجهاز)', _caller, NULL, true);
    UPDATE public.profiles SET active_session_id = 'banned-'||extract(epoch from now())::bigint::text
     WHERE id = _row.suspect_user_id;
    UPDATE public.suspected_device_matches
       SET status = 'confirmed', reviewed_by = _caller, reviewed_at = now(), updated_at = now()
     WHERE id = _id;
  ELSIF _action = 'dismiss' THEN
    UPDATE public.suspected_device_matches
       SET status = 'dismissed', reviewed_by = _caller, reviewed_at = now(), updated_at = now()
     WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'bad action';
  END IF;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_caller, 'suspected_device_'||_action, _row.suspect_user_id,
          jsonb_build_object('match_id', _id, 'score', _row.score));

  RETURN jsonb_build_object('ok', true, 'action', _action);
END;
$$;