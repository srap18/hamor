
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

  IF COALESCE(generic, false) THEN RETURN _hash; END IF;

  IF canon IS NULL OR length(canon) < 16 THEN
    IF _hash IS NULL OR length(_hash) < 16 THEN RETURN _hash; END IF;
    UPDATE public.device_identities SET canonical_hash = _hash WHERE id = _identity;
    RETURN _hash;
  END IF;

  IF canon IS DISTINCT FROM _hash THEN
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
        SELECT 1 FROM public.device_slots WHERE hardware_hash = canon AND user_id = rec.user_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.device_slots WHERE hardware_hash = canon AND slot_index = idx
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
