-- ============ 1. Steal log ============
CREATE TABLE IF NOT EXISTS public.steal_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thief_id uuid NOT NULL,
  victim_id uuid NOT NULL,
  attacker_ship_id uuid,
  target_ship_id uuid,
  result text NOT NULL,
  reject_reason text,
  link_reason text,
  fish_id text,
  quantity bigint NOT NULL DEFAULT 0,
  total_value bigint NOT NULL DEFAULT 0,
  device_id text,
  hardware_hash text,
  ip text,
  user_agent text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.steal_log TO service_role;
GRANT SELECT ON public.steal_log TO authenticated;
ALTER TABLE public.steal_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "steal_log_admin_read" ON public.steal_log;
CREATE POLICY "steal_log_admin_read" ON public.steal_log
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS steal_log_thief_idx ON public.steal_log(thief_id, created_at DESC);
CREATE INDEX IF NOT EXISTS steal_log_victim_idx ON public.steal_log(victim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS steal_log_pair_idx ON public.steal_log(thief_id, victim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS steal_log_ship_idx ON public.steal_log(attacker_ship_id, created_at DESC);

DROP TRIGGER IF EXISTS steal_log_touch ON public.steal_log;
CREATE TRIGGER steal_log_touch BEFORE UPDATE ON public.steal_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 2. Linked-account detection ============
CREATE OR REPLACE FUNCTION public.steal_link_reason(_a uuid, _b uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int;
BEGIN
  IF _a IS NULL OR _b IS NULL OR _a = _b THEN RETURN NULL; END IF;

  -- same device_id (current binding or historical usage)
  IF EXISTS (
    SELECT 1 FROM public.device_accounts d1
    JOIN public.device_accounts d2 ON d1.device_id = d2.device_id
    WHERE d1.user_id = _a AND d2.user_id = _b
  ) OR EXISTS (
    SELECT 1 FROM public.device_history h1
    JOIN public.device_history h2 ON h1.device_id = h2.device_id
    WHERE h1.user_id = _a AND h2.user_id = _b
  ) THEN
    RETURN 'device';
  END IF;

  -- same hardware fingerprint (device slots)
  IF EXISTS (
    SELECT 1 FROM public.device_slots s1
    JOIN public.device_slots s2 ON s1.hardware_hash = s2.hardware_hash
    WHERE s1.user_id = _a AND s2.user_id = _b
  ) THEN
    RETURN 'hardware';
  END IF;

  -- same hardware fingerprint / device identity
  IF EXISTS (
    SELECT 1 FROM public.device_identity_users u1
    JOIN public.device_identity_users u2
      ON (u1.identity_id = u2.identity_id
          OR (u1.hardware_hash IS NOT NULL AND u1.hardware_hash = u2.hardware_hash))
    WHERE u1.user_id = _a AND u2.user_id = _b
  ) THEN
    RETURN 'hardware';
  END IF;

  -- explicit account links
  IF EXISTS (
    SELECT 1 FROM public.account_links
    WHERE (user_a = _a AND user_b = _b) OR (user_a = _b AND user_b = _a)
  ) THEN
    RETURN 'account_link';
  END IF;

  -- proven shared network: both accounts used the same IP repeatedly and
  -- that IP is not a broad/shared carrier IP used by many players
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

-- ============ 3. Guard (limits) ============
-- result codes: 'started' (in-flight, counts), 'success', 'empty', 'rejected', 'cancelled'
CREATE OR REPLACE FUNCTION public.steal_guard_reason(_thief uuid, _victim uuid, OUT reason text, OUT link_reason text)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _pair int; _total int; _last timestamptz;
BEGIN
  reason := NULL;
  link_reason := public.steal_link_reason(_thief, _victim);

  IF link_reason IS NOT NULL THEN
    reason := 'linked_accounts';
    RETURN;
  END IF;

  SELECT max(created_at) INTO _last
  FROM public.steal_log
  WHERE thief_id = _thief AND victim_id = _victim
    AND result IN ('started', 'success');

  IF _last IS NOT NULL AND _last > now() - interval '2 hours' THEN
    reason := 'cooldown';
    RETURN;
  END IF;

  SELECT count(*) INTO _pair
  FROM public.steal_log
  WHERE thief_id = _thief AND victim_id = _victim
    AND result IN ('started', 'success')
    AND created_at > now() - interval '24 hours';

  IF COALESCE(_pair, 0) >= 3 THEN
    reason := 'pair_daily_limit';
    RETURN;
  END IF;

  SELECT count(*) INTO _total
  FROM public.steal_log
  WHERE thief_id = _thief
    AND result IN ('started', 'success')
    AND created_at > now() - interval '24 hours';

  IF COALESCE(_total, 0) >= 10 THEN
    reason := 'daily_limit';
    RETURN;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.steal_guard_reason(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.steal_guard_reason(uuid, uuid) TO service_role;

-- ============ 4. Logging helper ============
CREATE OR REPLACE FUNCTION public._steal_log_write(
  _thief uuid, _victim uuid, _attacker_ship uuid, _target_ship uuid,
  _result text, _reject text, _link text, _meta jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _id uuid; _dev text; _hw text;
BEGIN
  SELECT device_id INTO _dev FROM public.device_accounts WHERE user_id = _thief LIMIT 1;
  SELECT hardware_hash INTO _hw FROM public.device_slots WHERE user_id = _thief ORDER BY assigned_at DESC LIMIT 1;
  IF _hw IS NULL THEN
    SELECT hardware_hash INTO _hw FROM public.device_identity_users
     WHERE user_id = _thief AND hardware_hash IS NOT NULL ORDER BY last_seen DESC LIMIT 1;
  END IF;

  INSERT INTO public.steal_log(
    thief_id, victim_id, attacker_ship_id, target_ship_id, result, reject_reason,
    link_reason, device_id, hardware_hash, ip, user_agent, meta)
  VALUES (_thief, _victim, _attacker_ship, _target_ship, _result, _reject,
    _link, _dev, _hw, public._client_ip(), public._client_ua(), COALESCE(_meta, '{}'::jsonb))
  RETURNING id INTO _id;

  RETURN _id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._steal_log_write(uuid, uuid, uuid, uuid, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public._steal_log_write(uuid, uuid, uuid, uuid, text, text, text, jsonb) TO service_role;

-- ============ 5. Gate the entry point ============
CREATE OR REPLACE FUNCTION public.start_steal_mission(
  _attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS TABLE(ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _me uuid := auth.uid();
  _blocked timestamptz;
  _g record;
  _msg text;
  _ends timestamptz;
  _resume boolean := false;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT steal_blocked_until INTO _blocked FROM public.profiles WHERE id = _me;
  IF _blocked IS NOT NULL AND _blocked > now() THEN
    RAISE EXCEPTION 'blocked from stealing until %', _blocked;
  END IF;

  IF public.ship_has_police(_target_user_id, _target_ship_id) THEN
    RAISE EXCEPTION 'هذه السفينة محمية بواسطة الشرطي ولا يمكن سرقتها.';
  END IF;

  -- Serialize every steal attempt by this thief (atomic check + start + log)
  PERFORM pg_advisory_xact_lock(hashtextextended('steal_guard:' || _me::text, 0));

  -- Resuming the same in-flight mission must not consume a new slot
  SELECT true INTO _resume
  FROM public.ships_owned
  WHERE id = _attacker_ship_id AND user_id = _me
    AND stealing_ends_at IS NOT NULL AND stealing_ends_at > now()
    AND stealing_target_user_id = _target_user_id
    AND stealing_target_ship_id = _target_ship_id;

  IF NOT COALESCE(_resume, false) AND NOT public.is_admin(_me) THEN
    SELECT * INTO _g FROM public.steal_guard_reason(_me, _target_user_id);

    IF _g.reason IS NOT NULL THEN
      PERFORM public._steal_log_write(_me, _target_user_id, _attacker_ship_id, _target_ship_id,
        'rejected', _g.reason, _g.link_reason, '{}'::jsonb);

      _msg := CASE _g.reason
        WHEN 'linked_accounts' THEN 'ممنوع: هذا الحساب مرتبط بحسابك، لا يمكن السرقة بينكما.'
        WHEN 'cooldown' THEN 'يجب الانتظار ساعتين بين كل سرقة من نفس اللاعب.'
        WHEN 'pair_daily_limit' THEN 'وصلت للحد الأقصى: 3 سرقات من نفس اللاعب خلال 24 ساعة.'
        WHEN 'daily_limit' THEN 'وصلت للحد اليومي: 10 سرقات ناجحة خلال 24 ساعة.'
        ELSE 'السرقة غير مسموحة حاليًا.'
      END;
      RAISE EXCEPTION '%', _msg;
    END IF;
  END IF;

  SELECT s.ends_at INTO _ends
  FROM public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id) s;

  IF NOT COALESCE(_resume, false) THEN
    PERFORM public._steal_log_write(_me, _target_user_id, _attacker_ship_id, _target_ship_id,
      'started', NULL, NULL, jsonb_build_object('ends_at', _ends));
  END IF;

  RETURN QUERY SELECT _ends;
END;
$fn$;

-- ============ 6. Finalize the log entry on settlement ============
CREATE OR REPLACE FUNCTION public._steal_log_settle(
  _thief uuid, _attacker_ship uuid, _qty bigint, _value bigint, _fish text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.steal_log
   WHERE thief_id = _thief AND attacker_ship_id = _attacker_ship AND result = 'started'
   ORDER BY created_at DESC LIMIT 1;

  IF _id IS NULL THEN RETURN; END IF;

  UPDATE public.steal_log
     SET result = CASE WHEN COALESCE(_qty, 0) > 0 THEN 'success'
                       WHEN _reason = 'cancel' THEN 'cancelled'
                       ELSE 'empty' END,
         quantity = COALESCE(_qty, 0),
         total_value = COALESCE(_value, 0),
         fish_id = _fish,
         meta = meta || jsonb_build_object('settle_reason', _reason)
   WHERE id = _id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._steal_log_settle(uuid, uuid, bigint, bigint, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public._steal_log_settle(uuid, uuid, bigint, bigint, text, text) TO service_role;

-- ============ 7. Admin visibility ============
CREATE OR REPLACE FUNCTION public.admin_steal_log(_limit int DEFAULT 200, _thief uuid DEFAULT NULL, _victim uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, created_at timestamptz, thief_id uuid, thief_name text,
  victim_id uuid, victim_name text, result text, reject_reason text, link_reason text,
  fish_id text, quantity bigint, total_value bigint, device_id text, hardware_hash text, ip text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
  SELECT l.id, l.created_at, l.thief_id, pt.display_name, l.victim_id, pv.display_name,
         l.result, l.reject_reason, l.link_reason, l.fish_id, l.quantity, l.total_value,
         l.device_id, l.hardware_hash, l.ip
  FROM public.steal_log l
  LEFT JOIN public.profiles pt ON pt.id = l.thief_id
  LEFT JOIN public.profiles pv ON pv.id = l.victim_id
  WHERE (_thief IS NULL OR l.thief_id = _thief)
    AND (_victim IS NULL OR l.victim_id = _victim)
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 1000));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.admin_steal_log(int, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_steal_alerts(_hours int DEFAULT 48)
RETURNS TABLE(kind text, thief_id uuid, thief_name text, victim_id uuid, victim_name text, hits bigint, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _since timestamptz;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  _since := now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(_hours, 48), 720)));

  RETURN QUERY
  -- repeated pair farming
  SELECT 'repeat_pair'::text, l.thief_id, pt.display_name, l.victim_id, pv.display_name,
         count(*)::bigint, 'سرقات متكررة من نفس الضحية'::text
  FROM public.steal_log l
  LEFT JOIN public.profiles pt ON pt.id = l.thief_id
  LEFT JOIN public.profiles pv ON pv.id = l.victim_id
  WHERE l.created_at > _since AND l.result = 'success'
  GROUP BY l.thief_id, pt.display_name, l.victim_id, pv.display_name
  HAVING count(*) >= 3

  UNION ALL
  -- many thieves draining one victim
  SELECT 'swarmed_victim'::text, NULL::uuid, NULL::text, l.victim_id, pv.display_name,
         count(DISTINCT l.thief_id)::bigint, 'عدة حسابات تسرق من نفس اللاعب'::text
  FROM public.steal_log l
  LEFT JOIN public.profiles pv ON pv.id = l.victim_id
  WHERE l.created_at > _since AND l.result = 'success'
  GROUP BY l.victim_id, pv.display_name
  HAVING count(DISTINCT l.thief_id) >= 4

  UNION ALL
  -- repeated attempts to bypass the guard
  SELECT 'bypass_attempts'::text, l.thief_id, pt.display_name, l.victim_id, pv.display_name,
         count(*)::bigint, ('محاولات مرفوضة: ' || COALESCE(max(l.reject_reason), '?'))::text
  FROM public.steal_log l
  LEFT JOIN public.profiles pt ON pt.id = l.thief_id
  LEFT JOIN public.profiles pv ON pv.id = l.victim_id
  WHERE l.created_at > _since AND l.result = 'rejected'
  GROUP BY l.thief_id, pt.display_name, l.victim_id, pv.display_name
  HAVING count(*) >= 3

  UNION ALL
  -- burst of steal requests in a short window
  SELECT 'request_burst'::text, l.thief_id, pt.display_name, NULL::uuid, NULL::text,
         count(*)::bigint, 'عدد كبير من طلبات السرقة خلال ساعة'::text
  FROM public.steal_log l
  LEFT JOIN public.profiles pt ON pt.id = l.thief_id
  WHERE l.created_at > now() - interval '1 hour'
  GROUP BY l.thief_id, pt.display_name
  HAVING count(*) >= 8

  ORDER BY 6 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.admin_steal_alerts(int) TO authenticated;