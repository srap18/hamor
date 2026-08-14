CREATE OR REPLACE FUNCTION public.device_noise_collision(_noise text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _noise IS NULL OR length(trim(_noise)) < 32
    OR (SELECT count(DISTINCT m.user_id)
          FROM public.device_identities i
          JOIN public.device_identity_users m ON m.identity_id = i.id
         WHERE i.noise_key = trim(_noise)) > 10;
$$;

CREATE OR REPLACE FUNCTION public.device_match_score(_a uuid, _b uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
noise AS (
  SELECT EXISTS (
    SELECT 1 FROM public.device_identity_users ma
      JOIN public.device_identities da ON da.id = ma.identity_id
      JOIN public.device_identities db ON db.noise_key = da.noise_key
      JOIN public.device_identity_users mb ON mb.identity_id = db.id AND mb.user_id = _b
     WHERE ma.user_id = _a AND ma.confidence >= 95 AND mb.confidence >= 95
       AND NOT public.device_noise_collision(da.noise_key)
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
    + (SELECT CASE WHEN hit THEN 30 ELSE 0 END FROM noise)
    + (SELECT CASE WHEN hit THEN 30 ELSE 0 END FROM hw)
    + (SELECT CASE WHEN hit THEN 25 ELSE 0 END FROM reg)
    + (SELECT CASE WHEN hit THEN 15 ELSE 0 END FROM hist)
    + (SELECT CASE WHEN hit THEN 5  ELSE 0 END FROM ipx)
    -- same GPU/model AND same canvas+audio rendering noise = same physical
    -- device even across browsers / storage wipes / incognito.
    + (SELECT CASE WHEN (SELECT hit FROM stable) AND (SELECT hit FROM noise) THEN 20 ELSE 0 END)),
  'signals',
      (SELECT hit::int FROM native) + (SELECT hit::int FROM stable) + (SELECT hit::int FROM noise)
    + (SELECT hit::int FROM hw) + (SELECT hit::int FROM reg) + (SELECT hit::int FROM hist),
  'detail', jsonb_build_object(
    'native_id', (SELECT hit FROM native), 'stable_key', (SELECT hit FROM stable),
    'noise_key', (SELECT hit FROM noise),
    'hardware_hash', (SELECT hit FROM hw), 'device_registration', (SELECT hit FROM reg),
    'session_continuity', (SELECT hit FROM hist), 'shared_ip', (SELECT hit FROM ipx))
);
$$;

CREATE OR REPLACE FUNCTION public.device_peer_candidates(_uid uuid)
RETURNS TABLE(other_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT o.user_id FROM public.device_identity_users m
    JOIN public.device_identity_users o
      ON (o.identity_id = m.identity_id OR (o.hardware_hash = m.hardware_hash AND NOT public.device_hash_collision(m.hardware_hash)))
   WHERE m.user_id = _uid AND m.confidence >= 95 AND o.confidence >= 95 AND o.user_id <> _uid
     AND NOT public.device_identity_collision(m.identity_id)
  UNION
  SELECT DISTINCT mb.user_id FROM public.device_identity_users ma
    JOIN public.device_identities da ON da.id = ma.identity_id
    JOIN public.device_identities db ON db.noise_key = da.noise_key
    JOIN public.device_identity_users mb ON mb.identity_id = db.id AND mb.user_id <> _uid
   WHERE ma.user_id = _uid AND ma.confidence >= 95 AND mb.confidence >= 95
     AND NOT public.device_noise_collision(da.noise_key)
  UNION
  SELECT DISTINCT s2.user_id FROM public.device_slots s1
    JOIN public.device_slots s2 ON s2.hardware_hash = s1.hardware_hash AND s2.user_id <> _uid
   WHERE s1.user_id = _uid AND NOT public.device_hash_collision(s1.hardware_hash)
  UNION
  SELECT DISTINCT a2.user_id FROM public.device_accounts a1
    JOIN public.device_accounts a2 ON a2.device_id = a1.device_id AND a2.user_id <> _uid
   WHERE a1.user_id = _uid AND NOT public.device_id_is_collision(a1.device_id);
$$;