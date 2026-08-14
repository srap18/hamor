CREATE OR REPLACE FUNCTION public.device_slot_check(
  _hardware_hash text,
  _user_id uuid DEFAULT NULL,
  _email text DEFAULT NULL,
  _fingerprint_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  rl jsonb;
  lock_key bigint;
  slot_a public.device_slots;
  slot_b public.device_slots;
  taken_count integer;
  now_ts timestamptz := now();
  acct_created timestamptz;
BEGIN
  IF _user_id IS NOT NULL AND public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'admin_bypass');
  END IF;

  IF _hardware_hash IS NULL OR length(_hardware_hash) < 8 THEN
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'fingerprint_required');
  END IF;

  IF EXISTS (SELECT 1 FROM public.banned_devices WHERE device_id = _hardware_hash) THEN
    INSERT INTO public.device_slot_audit(hardware_hash, user_id, event_type, details)
    VALUES (_hardware_hash, _user_id, 'login_blocked_banned_device', jsonb_build_object('email', _email));
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'device_banned');
  END IF;

  -- Existing accounts are never blocked by device slots: a player may own
  -- several phones/tablets, or sign in on a family device. Only the creation
  -- of a brand-new account is limited to 2 per device.
  IF _user_id IS NOT NULL THEN
    SELECT created_at INTO acct_created FROM public.profiles WHERE id = _user_id;
    IF acct_created IS NOT NULL AND acct_created < now_ts - interval '30 minutes' THEN
      RETURN jsonb_build_object('action', 'allowed', 'reason', 'existing_account_login');
    END IF;
  END IF;

  rl := public.device_rate_limit_check(_hardware_hash);
  IF NOT COALESCE((rl->>'allowed')::boolean, true) THEN
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'too_many_attempts',
      'blocked_until', rl->>'blocked_until',
      'retry_after_seconds', (rl->>'retry_after_seconds')::int);
  END IF;

  lock_key := ('x' || substr(md5(_hardware_hash), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT * INTO slot_a FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 1 FOR UPDATE;
  SELECT * INTO slot_b FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND slot_index = 2 FOR UPDATE;

  taken_count := (CASE WHEN slot_a.user_id IS NOT NULL THEN 1 ELSE 0 END)
               + (CASE WHEN slot_b.user_id IS NOT NULL THEN 1 ELSE 0 END);

  IF _user_id IS NOT NULL AND (slot_a.user_id = _user_id OR slot_b.user_id = _user_id) THEN
    RETURN jsonb_build_object('action', 'allowed', 'reason', 'existing_slot', 'taken', taken_count);
  END IF;

  IF taken_count < 2 THEN
    RETURN jsonb_build_object('action', 'needs_confirmation', 'reason', 'slot_available',
      'taken', taken_count, 'free_slots', 2 - taken_count, 'lock_days', 14);
  END IF;

  IF (slot_a.locked_until IS NOT NULL AND slot_a.locked_until > now_ts)
     OR (slot_b.locked_until IS NOT NULL AND slot_b.locked_until > now_ts) THEN
    INSERT INTO public.device_slot_audit(hardware_hash, user_id, event_type, details)
    VALUES (_hardware_hash, _user_id, 'signup_blocked_device_full',
      jsonb_build_object('email', _email, 'slot_a_locked_until', slot_a.locked_until,
                         'slot_b_locked_until', slot_b.locked_until));
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'device_full',
      'new_account_only', true,
      'slot_a_locked_until', slot_a.locked_until, 'slot_b_locked_until', slot_b.locked_until);
  END IF;

  RETURN jsonb_build_object('action', 'needs_confirmation', 'reason', 'lock_expired',
    'taken', taken_count, 'free_slots', 1, 'lock_days', 14);
END;
$fn$;

-- Release devices that blocked real players recently so they can get back in now.
UPDATE public.device_slots s
SET locked_until = now()
WHERE s.locked_until > now()
  AND s.hardware_hash IN (
    SELECT DISTINCT hardware_hash FROM public.device_slot_audit
    WHERE event_type = 'login_blocked_third_account'
      AND created_at > now() - interval '60 days'
  );