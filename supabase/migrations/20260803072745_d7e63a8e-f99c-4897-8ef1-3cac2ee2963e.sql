CREATE OR REPLACE FUNCTION public.device_slot_check(_hardware_hash text, _user_id uuid, _email text, _fingerprint_version integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rl jsonb;
  lock_key bigint;
  slot_a public.device_slots;
  slot_b public.device_slots;
  taken_count integer;
  now_ts timestamptz := now();
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
    VALUES (_hardware_hash, _user_id, 'login_blocked_third_account',
      jsonb_build_object('email', _email, 'slot_a_locked_until', slot_a.locked_until,
                         'slot_b_locked_until', slot_b.locked_until));
    RETURN jsonb_build_object('action', 'blocked', 'reason', 'device_full',
      'slot_a_locked_until', slot_a.locked_until, 'slot_b_locked_until', slot_b.locked_until);
  END IF;

  RETURN jsonb_build_object('action', 'needs_confirmation', 'reason', 'lock_expired',
    'taken', taken_count, 'free_slots', 1, 'lock_days', 14);
END;
$function$;

CREATE OR REPLACE FUNCTION public.device_assign_slot(_hardware_hash text, _user_id uuid, _fingerprint_version integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  lock_key bigint;
  slot_a public.device_slots;
  slot_b public.device_slots;
  target_index integer;
  now_ts timestamptz := now();
  renewed boolean := false;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 8 OR _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  IF public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'admin_bypass');
  END IF;
  IF EXISTS (SELECT 1 FROM public.banned_devices WHERE device_id = _hardware_hash) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'device_banned');
  END IF;

  lock_key := ('x' || substr(md5(_hardware_hash), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);
  SELECT * INTO slot_a FROM public.device_slots WHERE hardware_hash = _hardware_hash AND slot_index = 1 FOR UPDATE;
  SELECT * INTO slot_b FROM public.device_slots WHERE hardware_hash = _hardware_hash AND slot_index = 2 FOR UPDATE;

  IF slot_a.user_id = _user_id THEN
    RETURN jsonb_build_object('ok', true, 'slot_index', 1, 'locked_until', slot_a.locked_until);
  ELSIF slot_b.user_id = _user_id THEN
    RETURN jsonb_build_object('ok', true, 'slot_index', 2, 'locked_until', slot_b.locked_until);
  ELSIF slot_a.user_id IS NULL OR slot_a.locked_until < now_ts THEN
    target_index := 1; renewed := slot_a.user_id IS NOT NULL;
  ELSIF slot_b.user_id IS NULL OR slot_b.locked_until < now_ts THEN
    target_index := 2; renewed := slot_b.user_id IS NOT NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'device_full');
  END IF;

  INSERT INTO public.device_slots(hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
  VALUES (_hardware_hash, target_index, _user_id, now_ts, now_ts + interval '14 days', _fingerprint_version)
  ON CONFLICT (hardware_hash, slot_index) DO UPDATE
    SET user_id=EXCLUDED.user_id, assigned_at=EXCLUDED.assigned_at,
        locked_until=EXCLUDED.locked_until, fingerprint_version=EXCLUDED.fingerprint_version;

  INSERT INTO public.device_slot_audit(hardware_hash, user_id, event_type, slot_index, fingerprint_version, details)
  VALUES (_hardware_hash, _user_id,
    CASE WHEN renewed THEN 'slot_renewed_after_lock' ELSE 'slot_created' END,
    target_index, _fingerprint_version,
    jsonb_build_object('locked_until', now_ts + interval '14 days'));

  RETURN jsonb_build_object('ok', true, 'slot_index', target_index,
    'locked_until', now_ts + interval '14 days');
END;
$function$;