-- =========================================================
-- 1) device_accounts: many accounts per device (was 1:1)
-- =========================================================
ALTER TABLE public.device_accounts DROP CONSTRAINT IF EXISTS device_accounts_pkey;
ALTER TABLE public.device_accounts ADD CONSTRAINT device_accounts_pkey PRIMARY KEY (device_id, user_id);
ALTER TABLE public.device_accounts ADD COLUMN IF NOT EXISTS hardware_hash text;
CREATE INDEX IF NOT EXISTS device_accounts_user_idx ON public.device_accounts(user_id);
CREATE INDEX IF NOT EXISTS device_accounts_hw_idx ON public.device_accounts(hardware_hash);

-- =========================================================
-- 2) remove ambiguous duplicate overloads (root cause of dead slots)
-- =========================================================
DROP FUNCTION IF EXISTS public.device_slot_check(text, uuid, text, smallint);
DROP FUNCTION IF EXISTS public.device_assign_slot(text, uuid);
DROP FUNCTION IF EXISTS public.device_assign_slot(text, uuid, smallint);
DROP FUNCTION IF EXISTS public.device_migrate_choose(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.device_migrate_choose(text, uuid, uuid, smallint);

CREATE OR REPLACE FUNCTION public.device_assign_slot(_hardware_hash text, _user_id uuid, _fingerprint_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count int; v_next smallint; v_existing record; v_locked timestamptz;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 OR _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_input');
  END IF;
  IF public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'privileged', true);
  END IF;

  SELECT * INTO v_existing FROM public.device_slots
   WHERE hardware_hash = _hardware_hash AND user_id = _user_id;
  IF FOUND THEN
    IF v_existing.locked_until <= now() THEN
      UPDATE public.device_slots
         SET assigned_at = now(), locked_until = now() + interval '14 days',
             fingerprint_version = _fingerprint_version::smallint
       WHERE id = v_existing.id
       RETURNING locked_until INTO v_locked;
      RETURN jsonb_build_object('ok', true, 'slot_index', v_existing.slot_index, 'locked_until', v_locked, 'renewed', true);
    END IF;
    RETURN jsonb_build_object('ok', true, 'slot_index', v_existing.slot_index, 'locked_until', v_existing.locked_until);
  END IF;

  SELECT count(*)::int INTO v_count FROM public.device_slots WHERE hardware_hash = _hardware_hash;
  IF v_count >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slots_full');
  END IF;

  v_next := CASE WHEN NOT EXISTS (SELECT 1 FROM public.device_slots WHERE hardware_hash = _hardware_hash AND slot_index = 1) THEN 1 ELSE 2 END;

  INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
  VALUES (_hardware_hash, v_next, _user_id, now(), now() + interval '14 days', _fingerprint_version::smallint)
  ON CONFLICT (hardware_hash, user_id) DO NOTHING
  RETURNING locked_until INTO v_locked;

  INSERT INTO public.device_slot_audit(hardware_hash, user_id, event_type, details)
  VALUES (_hardware_hash, _user_id, 'slot_created', jsonb_build_object('slot_index', v_next));

  RETURN jsonb_build_object('ok', true, 'slot_index', v_next, 'locked_until', v_locked);
END;
$$;

CREATE OR REPLACE FUNCTION public.device_migrate_choose(_hardware_hash text, _user_a uuid, _user_b uuid, _fingerprint_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count int;
BEGIN
  IF _hardware_hash IS NULL OR _user_a IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_input');
  END IF;
  SELECT count(*)::int INTO v_count FROM public.device_slots WHERE hardware_hash = _hardware_hash;
  IF v_count > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'already_migrated'); END IF;

  INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
  VALUES (_hardware_hash, 1, _user_a, now(), now() + interval '14 days', _fingerprint_version::smallint)
  ON CONFLICT DO NOTHING;

  IF _user_b IS NOT NULL AND _user_b <> _user_a THEN
    INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
    VALUES (_hardware_hash, 2, _user_b, now(), now() + interval '14 days', _fingerprint_version::smallint)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.device_slot_audit(hardware_hash, user_id, event_type, details)
  VALUES (_hardware_hash, _user_a, 'legacy_migration', jsonb_build_object('user_a', _user_a, 'user_b', _user_b));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- =========================================================
-- 3) collision-prone detection (never ban on a shared signal)
-- =========================================================
CREATE OR REPLACE FUNCTION public.device_identity_collision(_identity uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT is_generic FROM public.device_identities WHERE id = _identity), true)
      OR (SELECT count(DISTINCT user_id) FROM public.device_identity_users WHERE identity_id = _identity) > 10;
$$;

CREATE OR REPLACE FUNCTION public.device_hash_collision(_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _hash IS NULL OR length(trim(_hash)) < 16
      OR (SELECT count(DISTINCT user_id) FROM public.device_identity_users WHERE hardware_hash = trim(_hash)) > 10
      OR (SELECT count(DISTINCT identity_id) FROM public.device_identity_users WHERE hardware_hash = trim(_hash)) > 3;
$$;

-- raise the generic threshold from 6 to 10 users
CREATE OR REPLACE FUNCTION public.device_identity_mark_generic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n int;
BEGIN
  SELECT count(DISTINCT user_id) INTO _n FROM public.device_identity_users WHERE identity_id = NEW.identity_id;
  IF _n > 10 THEN
    UPDATE public.device_identities SET is_generic = true WHERE id = NEW.identity_id AND is_generic = false;
  END IF;
  RETURN NEW;
END;
$$;

-- neutralise currently colliding identities
UPDATE public.device_identities di SET is_generic = true
 WHERE is_generic = false
   AND (SELECT count(DISTINCT user_id) FROM public.device_identity_users m WHERE m.identity_id = di.id) > 10;

-- =========================================================
-- 4) multi-signal device match score
-- =========================================================
CREATE OR REPLACE FUNCTION public.device_match_score(_a uuid, _b uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH
native AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_identity_users ma
      JOIN public.device_identities da ON da.id = ma.identity_id
      JOIN public.device_identities db ON db.native_id = da.native_id AND da.native_id IS NOT NULL AND length(da.native_id) >= 12
      JOIN public.device_identity_users mb ON mb.identity_id = db.id AND mb.user_id = _b
     WHERE ma.user_id = _a AND ma.confidence >= 95 AND mb.confidence >= 95
       AND NOT public.device_identity_collision(da.id) AND NOT public.device_identity_collision(db.id)
  ) AS hit
),
stable AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_identity_users ma
      JOIN public.device_identities da ON da.id = ma.identity_id
      JOIN public.device_identities db ON db.stable_key = da.stable_key AND da.stable_key IS NOT NULL AND length(da.stable_key) >= 16
      JOIN public.device_identity_users mb ON mb.identity_id = db.id AND mb.user_id = _b
     WHERE ma.user_id = _a AND ma.confidence >= 95 AND mb.confidence >= 95
       AND NOT public.device_identity_collision(da.id) AND NOT public.device_identity_collision(db.id)
  ) AS hit
),
hw AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_identity_users ma
      JOIN public.device_identity_users mb ON mb.hardware_hash = ma.hardware_hash AND mb.user_id = _b
     WHERE ma.user_id = _a AND ma.confidence >= 95 AND mb.confidence >= 95
       AND NOT public.device_hash_collision(ma.hardware_hash)
  ) AS hit
),
reg AS (
  SELECT (
    EXISTS (
      SELECT 1 FROM public.device_slots sa JOIN public.device_slots sb ON sb.hardware_hash = sa.hardware_hash AND sb.user_id = _b
       WHERE sa.user_id = _a AND NOT public.device_hash_collision(sa.hardware_hash)
    ) OR EXISTS (
      SELECT 1 FROM public.device_accounts aa JOIN public.device_accounts ab ON ab.device_id = aa.device_id AND ab.user_id = _b
       WHERE aa.user_id = _a AND NOT public.device_id_is_collision(aa.device_id)
    )
  ) AS hit
),
hist AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_history ha JOIN public.device_history hb ON hb.device_id = ha.device_id AND hb.user_id = _b
     WHERE ha.user_id = _a AND length(ha.device_id) >= 16 AND NOT public.device_id_is_collision(ha.device_id)
  ) AS hit
),
ipx AS (
  SELECT EXISTS (
    SELECT 1 FROM public.user_ips ia JOIN public.user_ips ib ON ib.ip = ia.ip AND ib.user_id = _b
     WHERE ia.user_id = _a
  ) AS hit
)
SELECT jsonb_build_object(
  'score', LEAST(100,
      (SELECT CASE WHEN hit THEN 60 ELSE 0 END FROM native)
    + (SELECT CASE WHEN hit THEN 35 ELSE 0 END FROM stable)
    + (SELECT CASE WHEN hit THEN 30 ELSE 0 END FROM hw)
    + (SELECT CASE WHEN hit THEN 25 ELSE 0 END FROM reg)
    + (SELECT CASE WHEN hit THEN 15 ELSE 0 END FROM hist)
    + (SELECT CASE WHEN hit THEN 5  ELSE 0 END FROM ipx)),
  'signals',
      (SELECT hit::int FROM native) + (SELECT hit::int FROM stable) + (SELECT hit::int FROM hw)
    + (SELECT hit::int FROM reg) + (SELECT hit::int FROM hist),
  'detail', jsonb_build_object(
    'native_id', (SELECT hit FROM native), 'stable_key', (SELECT hit FROM stable),
    'hardware_hash', (SELECT hit FROM hw), 'device_registration', (SELECT hit FROM reg),
    'session_continuity', (SELECT hit FROM hist), 'shared_ip', (SELECT hit FROM ipx))
);
$$;

-- candidate peers that share at least one non-collision-prone signal
CREATE OR REPLACE FUNCTION public.device_peer_candidates(_uid uuid)
RETURNS TABLE(other_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT o.user_id FROM public.device_identity_users m
    JOIN public.device_identity_users o
      ON (o.identity_id = m.identity_id OR (o.hardware_hash = m.hardware_hash AND NOT public.device_hash_collision(m.hardware_hash)))
   WHERE m.user_id = _uid AND m.confidence >= 95 AND o.confidence >= 95 AND o.user_id <> _uid
     AND NOT public.device_identity_collision(m.identity_id)
  UNION
  SELECT DISTINCT s2.user_id FROM public.device_slots s1
    JOIN public.device_slots s2 ON s2.hardware_hash = s1.hardware_hash AND s2.user_id <> _uid
   WHERE s1.user_id = _uid AND NOT public.device_hash_collision(s1.hardware_hash)
  UNION
  SELECT DISTINCT a2.user_id FROM public.device_accounts a1
    JOIN public.device_accounts a2 ON a2.device_id = a1.device_id AND a2.user_id <> _uid
   WHERE a1.user_id = _uid AND NOT public.device_id_is_collision(a1.device_id);
$$;

-- =========================================================
-- 5) explicit action scope (account / device / both)
-- =========================================================
ALTER TABLE public.chat_mutes ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'both';
ALTER TABLE public.bans ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'both';
ALTER TABLE public.chat_mutes DROP CONSTRAINT IF EXISTS chat_mutes_scope_chk;
ALTER TABLE public.chat_mutes ADD CONSTRAINT chat_mutes_scope_chk CHECK (scope IN ('account','device','both'));
ALTER TABLE public.bans DROP CONSTRAINT IF EXISTS bans_scope_chk;
ALTER TABLE public.bans ADD CONSTRAINT bans_scope_chk CHECK (scope IN ('account','device','both'));

-- =========================================================
-- 6) mute / ban propagation gated by the confidence score
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_muted(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_mutes
     WHERE user_id = _user AND active = true AND (expires_at IS NULL OR expires_at > now())
  )
  OR (
    NOT public.is_admin(_user)
    AND EXISTS (
      SELECT 1
        FROM public.device_peer_candidates(_user) c
        JOIN public.chat_mutes cm ON cm.user_id = c.other_id
         AND cm.active = true AND (cm.expires_at IS NULL OR cm.expires_at > now())
         AND COALESCE(cm.scope, 'both') IN ('device', 'both')
        CROSS JOIN LATERAL (SELECT public.device_match_score(_user, c.other_id) AS v) s
       WHERE (s.v->>'score')::int >= 80 AND (s.v->>'signals')::int >= 2
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_hardware_banned(_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
    ) OR EXISTS (
      SELECT 1 FROM public.device_slots s
        JOIN public.bans b ON b.user_id = s.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
                          AND COALESCE(b.scope, 'both') IN ('device', 'both')
       WHERE s.hardware_hash = trim(_hash) AND NOT public.is_admin(s.user_id)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.device_identity_is_banned(_identity uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _identity IS NULL OR public.device_identity_collision(_identity) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.device_identity_users m
        JOIN public.bans b ON b.user_id = m.user_id AND b.active = true
                          AND (b.expires_at IS NULL OR b.expires_at > now())
                          AND COALESCE(b.scope, 'both') IN ('device', 'both')
       WHERE m.identity_id = _identity AND m.confidence >= 95 AND NOT public.is_admin(m.user_id)
    )
  END;
$$;

-- =========================================================
-- 7) durable device <-> account linking (survives cookie wipes)
-- =========================================================
CREATE OR REPLACE FUNCTION public.device_link_register(_device_id text, _hardware_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF _device_id IS NULL OR length(_device_id) < 8 OR length(_device_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_device_id');
  END IF;

  INSERT INTO public.device_accounts(device_id, user_id, hardware_hash)
  VALUES (_device_id, v_uid, NULLIF(trim(COALESCE(_hardware_hash, '')), ''))
  ON CONFLICT (device_id, user_id) DO UPDATE
    SET updated_at = now(),
        hardware_hash = COALESCE(EXCLUDED.hardware_hash, public.device_accounts.hardware_hash);

  IF _hardware_hash IS NOT NULL AND length(trim(_hardware_hash)) >= 16
     AND NOT public.device_is_privileged(v_uid) THEN
    PERFORM public.device_assign_slot(trim(_hardware_hash), v_uid, 1);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.device_link_register(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_match_score(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_peer_candidates(uuid) TO authenticated;