
ALTER TABLE public.device_identities ADD COLUMN IF NOT EXISTS canonical_hash text;
CREATE INDEX IF NOT EXISTS device_identities_canonical_hash_idx ON public.device_identities(canonical_hash);

UPDATE public.device_identities di
SET canonical_hash = s.h
FROM (
  SELECT DISTINCT ON (identity_id) identity_id, hardware_hash AS h
  FROM public.device_identity_users
  WHERE hardware_hash IS NOT NULL AND length(hardware_hash) >= 16
  ORDER BY identity_id, first_seen ASC
) s
WHERE s.identity_id = di.id AND di.canonical_hash IS NULL;

CREATE OR REPLACE FUNCTION public.device_identity_canonical(_identity uuid, _hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  canon text;
  generic boolean;
  rec record;
  idx smallint;
BEGIN
  IF _identity IS NULL THEN RETURN _hash; END IF;

  SELECT canonical_hash, is_generic INTO canon, generic
  FROM public.device_identities WHERE id = _identity;

  -- Shared/model-generic identities must never merge two real people.
  IF COALESCE(generic, false) THEN RETURN _hash; END IF;

  IF canon IS NULL OR length(canon) < 16 THEN
    IF _hash IS NULL OR length(_hash) < 16 THEN RETURN _hash; END IF;
    UPDATE public.device_identities SET canonical_hash = _hash WHERE id = _identity;
    RETURN _hash;
  END IF;

  -- Carry the two oldest accounts of this physical device onto the canonical
  -- code, so extra installs cannot hand out fresh slots.
  IF canon IS DISTINCT FROM _hash THEN
    idx := 0;
    FOR rec IN
      SELECT DISTINCT ON (u.user_id) u.user_id, u.first_seen
      FROM public.device_identity_users u
      WHERE u.identity_id = _identity
      ORDER BY u.user_id, u.first_seen ASC
    LOOP
      NULL;
    END LOOP;

    idx := 0;
    FOR rec IN
      SELECT user_id, min(first_seen) AS fs
      FROM public.device_identity_users
      WHERE identity_id = _identity
      GROUP BY user_id
      ORDER BY min(first_seen) ASC
      LIMIT 2
    LOOP
      idx := idx + 1;
      IF NOT EXISTS (
        SELECT 1 FROM public.device_slots
        WHERE hardware_hash = canon AND user_id = rec.user_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.device_slots
        WHERE hardware_hash = canon AND slot_index = idx
      ) THEN
        INSERT INTO public.device_slots(hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
        VALUES (canon, idx, rec.user_id, COALESCE(rec.fs, now()), NULL, 1)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN canon;
END;
$$;

REVOKE ALL ON FUNCTION public.device_identity_canonical(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.device_identity_canonical(uuid, text) TO service_role;
