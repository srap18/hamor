
-- ============================================================
-- Device Slot System — Production Hardening
-- 1) Rate limiting on slot checks per hardware hash
-- 2) Race-condition safe slot assignment (advisory lock + FOR UPDATE)
-- 3) Monitoring/metrics function for admins
-- ============================================================

-- ---------- 1) Rate limiting table ----------
CREATE TABLE IF NOT EXISTS public.device_slot_rate_limit (
  hardware_hash text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.device_slot_rate_limit TO authenticated;
GRANT ALL ON public.device_slot_rate_limit TO service_role;
ALTER TABLE public.device_slot_rate_limit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "priv read rate limit"
  ON public.device_slot_rate_limit FOR SELECT
  TO authenticated
  USING (public.device_is_privileged(auth.uid()));

-- Rate-limit check helper. Returns true when the request is ALLOWED.
-- Rules: max 10 distinct check attempts per hardware_hash in a 10-minute window.
-- On breach → block for 30 minutes.
CREATE OR REPLACE FUNCTION public.device_rate_limit_check(_hardware_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.device_slot_rate_limit;
  window_len interval := interval '10 minutes';
  block_len  interval := interval '30 minutes';
  max_hits   integer  := 10;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 8 THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  INSERT INTO public.device_slot_rate_limit(hardware_hash, attempt_count, window_started_at, last_attempt_at)
  VALUES (_hardware_hash, 1, now(), now())
  ON CONFLICT (hardware_hash) DO UPDATE
    SET last_attempt_at = now(),
        window_started_at = CASE
          WHEN public.device_slot_rate_limit.blocked_until IS NOT NULL
               AND now() < public.device_slot_rate_limit.blocked_until
            THEN public.device_slot_rate_limit.window_started_at
          WHEN now() - public.device_slot_rate_limit.window_started_at > window_len
            THEN now()
          ELSE public.device_slot_rate_limit.window_started_at
        END,
        attempt_count = CASE
          WHEN public.device_slot_rate_limit.blocked_until IS NOT NULL
               AND now() < public.device_slot_rate_limit.blocked_until
            THEN public.device_slot_rate_limit.attempt_count
          WHEN now() - public.device_slot_rate_limit.window_started_at > window_len
            THEN 1
          ELSE public.device_slot_rate_limit.attempt_count + 1
        END
  RETURNING * INTO row;

  -- Still blocked?
  IF row.blocked_until IS NOT NULL AND now() < row.blocked_until THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'blocked_until', row.blocked_until,
      'retry_after_seconds', GREATEST(1, EXTRACT(EPOCH FROM (row.blocked_until - now()))::int)
    );
  END IF;

  -- Trip block?
  IF row.attempt_count > max_hits THEN
    UPDATE public.device_slot_rate_limit
       SET blocked_until = now() + block_len
     WHERE hardware_hash = _hardware_hash
     RETURNING * INTO row;

    INSERT INTO public.device_slot_audit(hardware_hash, event, details)
    VALUES (_hardware_hash, 'rate_limited',
            jsonb_build_object('attempts', row.attempt_count, 'blocked_until', row.blocked_until));

    RETURN jsonb_build_object(
      'allowed', false,
      'blocked_until', row.blocked_until,
      'retry_after_seconds', GREATEST(1, EXTRACT(EPOCH FROM (row.blocked_until - now()))::int)
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'attempts', row.attempt_count);
END;
$$;

-- ---------- 2) Race-condition safe slot check + assign ----------
-- Wrap slot check with rate limit + advisory lock keyed on hardware_hash so that
-- two concurrent requests for the same device serialize and can't create a 3rd slot.
CREATE OR REPLACE FUNCTION public.device_slot_check(
  _hardware_hash text,
  _user_id uuid,
  _email text,
  _fingerprint_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rl jsonb;
  lock_key bigint;
  is_admin boolean := false;
  slot_a public.device_slots;
  slot_b public.device_slots;
  taken_count integer;
  now_ts timestamptz := now();
BEGIN
  -- Admin bypass
  IF _user_id IS NOT NULL AND public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'admin_bypass');
  END IF;

  -- Rate limit
  rl := public.device_rate_limit_check(_hardware_hash);
  IF NOT COALESCE((rl->>'allowed')::boolean, true) THEN
    RETURN jsonb_build_object(
      'action', 'rate_limited',
      'reason', 'too_many_attempts',
      'blocked_until', rl->>'blocked_until',
      'retry_after_seconds', (rl->>'retry_after_seconds')::int
    );
  END IF;

  IF _hardware_hash IS NULL OR length(_hardware_hash) < 8 THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'no_fingerprint');
  END IF;

  -- Serialize concurrent requests for the SAME device
  lock_key := ('x' || substr(md5(_hardware_hash), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  -- Read slots under FOR UPDATE so a concurrent assignment sees our lock
  SELECT * INTO slot_a FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 1 FOR UPDATE;
  SELECT * INTO slot_b FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 2 FOR UPDATE;

  taken_count := (CASE WHEN slot_a.user_id IS NOT NULL THEN 1 ELSE 0 END)
               + (CASE WHEN slot_b.user_id IS NOT NULL THEN 1 ELSE 0 END);

  -- Already assigned to this user → allow
  IF _user_id IS NOT NULL AND (
       slot_a.user_id = _user_id OR slot_b.user_id = _user_id
     ) THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'existing_slot', 'taken', taken_count);
  END IF;

  -- Free slot available
  IF taken_count < 2 THEN
    RETURN jsonb_build_object('action', 'warn_new_slot', 'reason', 'slot_available',
                              'taken', taken_count);
  END IF;

  -- Both slots taken → check locks
  IF (slot_a.locked_until IS NOT NULL AND slot_a.locked_until > now_ts)
     OR (slot_b.locked_until IS NOT NULL AND slot_b.locked_until > now_ts) THEN
    INSERT INTO public.device_slot_audit(hardware_hash, user_id, event, details)
    VALUES (_hardware_hash, _user_id, 'login_blocked_third_account',
            jsonb_build_object('email', _email, 'slot_a_locked_until', slot_a.locked_until,
                               'slot_b_locked_until', slot_b.locked_until));

    RETURN jsonb_build_object('action', 'blocked', 'reason', 'device_full',
                              'slot_a_locked_until', slot_a.locked_until,
                              'slot_b_locked_until', slot_b.locked_until);
  END IF;

  -- Locks expired → allow renewal
  RETURN jsonb_build_object('action', 'warn_new_slot', 'reason', 'lock_expired', 'taken', taken_count);
END;
$$;

-- Same locking pattern in assign_slot
CREATE OR REPLACE FUNCTION public.device_assign_slot(
  _hardware_hash text,
  _user_id uuid,
  _fingerprint_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_key bigint;
  slot_a public.device_slots;
  slot_b public.device_slots;
  target_index integer;
  target_slot public.device_slots;
  lock_days integer := 14;
  now_ts timestamptz := now();
  renewed boolean := false;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 8 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'no_fingerprint');
  END IF;

  IF public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'admin_bypass');
  END IF;

  lock_key := ('x' || substr(md5(_hardware_hash), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT * INTO slot_a FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 1 FOR UPDATE;
  SELECT * INTO slot_b FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 2 FOR UPDATE;

  -- Already assigned
  IF slot_a.user_id = _user_id THEN target_index := 1; target_slot := slot_a;
  ELSIF slot_b.user_id = _user_id THEN target_index := 2; target_slot := slot_b;
  ELSIF slot_a.user_id IS NULL OR (slot_a.locked_until IS NOT NULL AND slot_a.locked_until < now_ts) THEN
    target_index := 1; target_slot := slot_a;
    renewed := slot_a.user_id IS NOT NULL AND slot_a.user_id <> _user_id;
  ELSIF slot_b.user_id IS NULL OR (slot_b.locked_until IS NOT NULL AND slot_b.locked_until < now_ts) THEN
    target_index := 2; target_slot := slot_b;
    renewed := slot_b.user_id IS NOT NULL AND slot_b.user_id <> _user_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'device_full');
  END IF;

  INSERT INTO public.device_slots(hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
  VALUES (_hardware_hash, target_index, _user_id, now_ts, now_ts + (lock_days || ' days')::interval, _fingerprint_version)
  ON CONFLICT (hardware_hash, slot_index) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        assigned_at = EXCLUDED.assigned_at,
        locked_until = EXCLUDED.locked_until,
        fingerprint_version = EXCLUDED.fingerprint_version;

  INSERT INTO public.device_slot_audit(hardware_hash, user_id, event, details)
  VALUES (_hardware_hash, _user_id,
          CASE WHEN renewed THEN 'slot_renewed_after_lock' ELSE 'slot_created' END,
          jsonb_build_object('slot_index', target_index, 'locked_until', now_ts + (lock_days || ' days')::interval));

  RETURN jsonb_build_object('ok', true, 'slot_index', target_index,
                            'locked_until', now_ts + (lock_days || ' days')::interval);
END;
$$;

-- ---------- 3) Monitoring / metrics ----------
CREATE OR REPLACE FUNCTION public.device_slot_metrics(_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - (_days || ' days')::interval;
  active_devices bigint;
  full_devices bigint;
  blocked_count bigint;
  appeals_total bigint;
  appeals_approved bigint;
  appeals_rejected bigint;
  appeals_pending bigint;
  ratelimit_hits bigint;
  fingerprints_total bigint;
BEGIN
  IF NOT public.device_is_privileged(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(DISTINCT hardware_hash) INTO active_devices
    FROM public.device_slots WHERE assigned_at >= cutoff;

  SELECT COUNT(*) INTO full_devices FROM (
    SELECT hardware_hash FROM public.device_slots
     WHERE user_id IS NOT NULL
     GROUP BY hardware_hash HAVING COUNT(*) >= 2
  ) t;

  SELECT COUNT(*) INTO blocked_count
    FROM public.device_slot_audit
   WHERE event = 'login_blocked_third_account' AND created_at >= cutoff;

  SELECT COUNT(*) INTO ratelimit_hits
    FROM public.device_slot_audit
   WHERE event = 'rate_limited' AND created_at >= cutoff;

  SELECT COUNT(*) FILTER (WHERE created_at >= cutoff),
         COUNT(*) FILTER (WHERE status = 'approved' AND created_at >= cutoff),
         COUNT(*) FILTER (WHERE status = 'rejected' AND created_at >= cutoff),
         COUNT(*) FILTER (WHERE status = 'pending')
    INTO appeals_total, appeals_approved, appeals_rejected, appeals_pending
    FROM public.device_appeals;

  SELECT COUNT(*) INTO fingerprints_total FROM public.device_fingerprints;

  RETURN jsonb_build_object(
    'window_days', _days,
    'active_devices', active_devices,
    'full_devices', full_devices,
    'third_account_blocks', blocked_count,
    'rate_limit_trips', ratelimit_hits,
    'fingerprints_total', fingerprints_total,
    'appeals', jsonb_build_object(
      'total', appeals_total,
      'approved', appeals_approved,
      'rejected', appeals_rejected,
      'pending', appeals_pending,
      'approval_rate',
        CASE WHEN (appeals_approved + appeals_rejected) > 0
          THEN round(100.0 * appeals_approved / (appeals_approved + appeals_rejected), 1)
          ELSE 0 END
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.device_rate_limit_check(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.device_slot_metrics(integer) TO authenticated, service_role;
