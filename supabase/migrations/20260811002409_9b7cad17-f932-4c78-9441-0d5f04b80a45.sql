CREATE OR REPLACE FUNCTION public.steal_link_reason(_a uuid, _b uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _max_share constant int := 4;  -- ignore collided / shared identifiers
  _n int;
BEGIN
  IF _a IS NULL OR _b IS NULL OR _a = _b THEN RETURN NULL; END IF;

  -- explicit admin/system link
  IF EXISTS (
    SELECT 1 FROM public.account_links
    WHERE (user_a = _a AND user_b = _b) OR (user_a = _b AND user_b = _a)
  ) THEN
    RETURN 'account_link';
  END IF;

  -- same device_id (current binding)
  IF EXISTS (
    SELECT 1 FROM public.device_accounts d1
    JOIN public.device_accounts d2 ON d1.device_id = d2.device_id
    WHERE d1.user_id = _a AND d2.user_id = _b
  ) THEN
    RETURN 'device';
  END IF;

  -- same device_id historically, ignoring device ids shared by many accounts
  IF EXISTS (
    SELECT 1 FROM public.device_history h1
    JOIN public.device_history h2 ON h1.device_id = h2.device_id
    WHERE h1.user_id = _a AND h2.user_id = _b
      AND (SELECT count(DISTINCT x.user_id) FROM public.device_history x
            WHERE x.device_id = h1.device_id) <= _max_share
  ) THEN
    RETURN 'device';
  END IF;

  -- device slots (hardware fingerprint, max 2 accounts per device by design)
  IF EXISTS (
    SELECT 1 FROM public.device_slots s1
    JOIN public.device_slots s2 ON s1.hardware_hash = s2.hardware_hash
    WHERE s1.user_id = _a AND s2.user_id = _b
  ) THEN
    RETURN 'hardware';
  END IF;

  -- same hardware hash, ignoring hashes that collide across many accounts
  IF EXISTS (
    SELECT 1 FROM public.device_identity_users u1
    JOIN public.device_identity_users u2 ON u1.hardware_hash = u2.hardware_hash
    WHERE u1.user_id = _a AND u2.user_id = _b
      AND u1.hardware_hash IS NOT NULL
      AND (SELECT count(DISTINCT x.user_id) FROM public.device_identity_users x
            WHERE x.hardware_hash = u1.hardware_hash) <= _max_share
  ) THEN
    RETURN 'hardware';
  END IF;

  -- same device identity, excluding generic / broadly-shared identities
  IF EXISTS (
    SELECT 1 FROM public.device_identity_users u1
    JOIN public.device_identity_users u2 ON u1.identity_id = u2.identity_id
    JOIN public.device_identities di ON di.id = u1.identity_id
    WHERE u1.user_id = _a AND u2.user_id = _b
      AND di.is_generic = false
      AND (SELECT count(DISTINCT x.user_id) FROM public.device_identity_users x
            WHERE x.identity_id = u1.identity_id) <= _max_share
  ) THEN
    RETURN 'hardware';
  END IF;

  -- proven shared network: repeated usage of the same non-carrier IP
  SELECT count(*) INTO _n
  FROM public.user_ips i1
  JOIN public.user_ips i2 ON i1.ip = i2.ip
  WHERE i1.user_id = _a AND i2.user_id = _b
    AND i1.hits >= 2 AND i2.hits >= 2
    AND i1.last_seen > now() - interval '45 days'
    AND i2.last_seen > now() - interval '45 days'
    AND (SELECT count(DISTINCT x.user_id) FROM public.user_ips x WHERE x.ip = i1.ip) <= 6;

  IF COALESCE(_n, 0) > 0 THEN RETURN 'network'; END IF;

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.steal_link_reason(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.steal_link_reason(uuid, uuid) TO service_role;