-- 1) Allow support between accounts on the same device
DO $$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='send_support_impl';

  _new := replace(_def,
    'IF public.users_same_device(_me, _recipient_id) THEN',
    'IF false THEN');
  IF _new = _def THEN RAISE EXCEPTION 'send_support_impl: same-device guard not found'; END IF;
  EXECUTE _new;
END $$;

-- 2) Allow steal between accounts on the same device
DO $$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='start_steal_mission_impl';

  _new := replace(_def,
    'IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN',
    'IF false THEN');
  IF _new = _def THEN RAISE EXCEPTION 'start_steal_mission_impl: same-device guard not found'; END IF;
  EXECUTE _new;
END $$;

-- 3) Device / hardware links no longer block steal (other guards stay)
CREATE OR REPLACE FUNCTION public.steal_link_reason(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n int;
BEGIN
  IF _a IS NULL OR _b IS NULL OR _a = _b THEN RETURN NULL; END IF;

  -- explicit admin/system link (device links are allowed by design: 2 slots per device)
  IF EXISTS (
    SELECT 1 FROM public.account_links
    WHERE ((user_a = _a AND user_b = _b) OR (user_a = _b AND user_b = _a))
      AND COALESCE(link_type,'') NOT IN ('device','hardware')
  ) THEN
    RETURN 'account_link';
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
$function$;