
-- =========================================================================
-- Device Slot System: max 2 accounts per physical device, 14-day lock
-- =========================================================================

-- 1) Store per-device fingerprint signal components for weighted fuzzy match
CREATE TABLE IF NOT EXISTS public.device_fingerprints (
  hardware_hash text PRIMARY KEY,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.device_fingerprints TO authenticated;
GRANT ALL ON public.device_fingerprints TO service_role;
ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access_fp" ON public.device_fingerprints FOR ALL USING (false);

-- 2) The core slots table: 2 rows per hardware_hash max
CREATE TABLE IF NOT EXISTS public.device_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_hash text NOT NULL,
  slot_index smallint NOT NULL CHECK (slot_index IN (1, 2)),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hardware_hash, slot_index),
  UNIQUE (hardware_hash, user_id)
);

CREATE INDEX idx_device_slots_hw ON public.device_slots (hardware_hash);
CREATE INDEX idx_device_slots_user ON public.device_slots (user_id);

GRANT SELECT ON public.device_slots TO authenticated;
GRANT ALL ON public.device_slots TO service_role;
ALTER TABLE public.device_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_reads_own_slot" ON public.device_slots FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- 3) Appeals from users blocked by the slot system
CREATE TABLE IF NOT EXISTS public.device_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_hash text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  next_allowed_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_appeals_hw ON public.device_appeals (hardware_hash);
CREATE INDEX idx_device_appeals_status ON public.device_appeals (status);

GRANT SELECT, INSERT ON public.device_appeals TO authenticated;
GRANT ALL ON public.device_appeals TO service_role;
ALTER TABLE public.device_appeals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_reads_own_appeals" ON public.device_appeals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- =========================================================================
-- Helper: bypass slot checks for admins/moderators
-- =========================================================================
CREATE OR REPLACE FUNCTION public.device_is_privileged(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin','moderator')
  );
$$;

-- =========================================================================
-- Main check: what should happen when this user tries to sign in on this device?
-- Returns action in { allowed, needs_confirmation, needs_migration, blocked }
-- =========================================================================
CREATE OR REPLACE FUNCTION public.device_slot_check(
  _hardware_hash text,
  _user_id uuid DEFAULT NULL,
  _email text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_existing record;
  v_slots jsonb;
  v_pending_appeal record;
  v_historic_users uuid[];
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 THEN
    RETURN jsonb_build_object('action','allowed','reason','no_fingerprint');
  END IF;

  -- Admins/mods always bypass
  IF _user_id IS NOT NULL AND public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('action','allowed','reason','privileged');
  END IF;

  -- If the user already owns a slot on this device, allow.
  IF _user_id IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.device_slots
     WHERE hardware_hash = _hardware_hash AND user_id = _user_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'action','allowed',
        'reason','owns_slot',
        'slot_index', v_existing.slot_index,
        'locked_until', v_existing.locked_until
      );
    END IF;
  END IF;

  SELECT count(*)::int INTO v_count
    FROM public.device_slots WHERE hardware_hash = _hardware_hash;

  IF v_count < 2 THEN
    -- Free slot available: confirm with the user before locking it.
    RETURN jsonb_build_object(
      'action','needs_confirmation',
      'free_slots', 2 - v_count,
      'lock_days', 14
    );
  END IF;

  -- 2 slots occupied. Check if any is expired and unclaimed by current user.
  -- (Both are non-empty; we don't auto-release. User must free one.)
  SELECT jsonb_agg(jsonb_build_object(
    'slot_index', slot_index,
    'user_id', user_id,
    'locked_until', locked_until,
    'expired', locked_until < now()
  ) ORDER BY slot_index) INTO v_slots
  FROM public.device_slots WHERE hardware_hash = _hardware_hash;

  -- Pending appeal?
  SELECT * INTO v_pending_appeal
    FROM public.device_appeals
   WHERE hardware_hash = _hardware_hash AND status = 'pending'
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'action','blocked',
    'reason','slots_full',
    'slots', v_slots,
    'has_pending_appeal', v_pending_appeal.id IS NOT NULL,
    'appeal_cooldown_until', (
      SELECT next_allowed_at FROM public.device_appeals
       WHERE hardware_hash = _hardware_hash AND status = 'rejected'
       ORDER BY resolved_at DESC LIMIT 1
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.device_slot_check(text, uuid, text) TO authenticated, anon, service_role;

-- =========================================================================
-- Assign the current user to a free slot on this device (after user confirm)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.device_assign_slot(
  _hardware_hash text,
  _user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_next_slot smallint;
  v_existing record;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 OR _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','bad_input');
  END IF;
  IF public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'privileged', true);
  END IF;

  -- Already assigned?
  SELECT * INTO v_existing FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND user_id = _user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'slot_index', v_existing.slot_index, 'locked_until', v_existing.locked_until);
  END IF;

  SELECT count(*)::int INTO v_count
    FROM public.device_slots WHERE hardware_hash = _hardware_hash;
  IF v_count >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'error','slots_full');
  END IF;

  v_next_slot := CASE
    WHEN NOT EXISTS(SELECT 1 FROM public.device_slots WHERE hardware_hash = _hardware_hash AND slot_index = 1) THEN 1
    ELSE 2 END;

  INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until)
  VALUES (_hardware_hash, v_next_slot, _user_id, now(), now() + interval '14 days')
  ON CONFLICT (hardware_hash, user_id) DO NOTHING
  RETURNING slot_index, locked_until INTO v_next_slot, v_existing.locked_until;

  RETURN jsonb_build_object('ok', true, 'slot_index', v_next_slot, 'locked_until', v_existing.locked_until);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_assign_slot(text, uuid) TO authenticated, service_role;

-- =========================================================================
-- Migration flow: legacy devices with >2 users. Return the list of user_ids
-- historically seen on this device (from device_accounts), so UI can let
-- the user pick which 2 to keep.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.device_migration_candidates(_hardware_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_users jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'display_name', COALESCE(p.display_name, p.username, split_part(u.email,'@',1)),
    'email', u.email,
    'last_seen', da.updated_at
  ) ORDER BY da.updated_at DESC NULLS LAST) INTO v_users
  FROM public.device_accounts da
  JOIN auth.users u ON u.id = da.user_id
  LEFT JOIN public.profiles p ON p.id = da.user_id
  WHERE da.device_id = _hardware_hash;

  RETURN jsonb_build_object('candidates', COALESCE(v_users, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_migration_candidates(text) TO authenticated, anon, service_role;

-- Choose 2 user_ids as the permanent slots for this device (legacy migration)
CREATE OR REPLACE FUNCTION public.device_migrate_choose(
  _hardware_hash text,
  _user_a uuid,
  _user_b uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  IF _hardware_hash IS NULL OR _user_a IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','bad_input');
  END IF;
  SELECT count(*)::int INTO v_count FROM public.device_slots WHERE hardware_hash = _hardware_hash;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error','already_migrated');
  END IF;

  INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until)
  VALUES (_hardware_hash, 1, _user_a, now(), now() + interval '14 days')
  ON CONFLICT DO NOTHING;

  IF _user_b IS NOT NULL AND _user_b <> _user_a THEN
    INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until)
    VALUES (_hardware_hash, 2, _user_b, now(), now() + interval '14 days')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_migrate_choose(text, uuid, uuid) TO authenticated, service_role;

-- =========================================================================
-- Appeals
-- =========================================================================
CREATE OR REPLACE FUNCTION public.device_submit_appeal(
  _hardware_hash text,
  _email text,
  _message text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending record;
  v_recent_reject record;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 OR _message IS NULL OR length(trim(_message)) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error','bad_input');
  END IF;

  -- One active appeal per device
  SELECT * INTO v_pending FROM public.device_appeals
   WHERE hardware_hash = _hardware_hash AND status = 'pending' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error','already_pending');
  END IF;

  -- 7-day cooldown after rejection
  SELECT * INTO v_recent_reject FROM public.device_appeals
   WHERE hardware_hash = _hardware_hash AND status = 'rejected'
   ORDER BY resolved_at DESC LIMIT 1;
  IF FOUND AND v_recent_reject.next_allowed_at IS NOT NULL AND v_recent_reject.next_allowed_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error','cooldown', 'next_allowed_at', v_recent_reject.next_allowed_at);
  END IF;

  INSERT INTO public.device_appeals (hardware_hash, email, message, status)
  VALUES (_hardware_hash, _email, substr(_message, 1, 2000), 'pending');

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_submit_appeal(text, text, text) TO authenticated, anon, service_role;

-- Admin: approve appeal -> reset slots so the user can pick 2 fresh accounts
CREATE OR REPLACE FUNCTION public.device_admin_approve_appeal(
  _appeal_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appeal record;
BEGIN
  IF NOT public.device_is_privileged(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error','forbidden');
  END IF;
  SELECT * INTO v_appeal FROM public.device_appeals WHERE id = _appeal_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','not_found'); END IF;

  DELETE FROM public.device_slots WHERE hardware_hash = v_appeal.hardware_hash;

  UPDATE public.device_appeals
     SET status = 'approved', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = _appeal_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_admin_approve_appeal(uuid) TO authenticated, service_role;

-- Admin: reject appeal -> apply 7-day cooldown
CREATE OR REPLACE FUNCTION public.device_admin_reject_appeal(
  _appeal_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.device_is_privileged(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error','forbidden');
  END IF;
  UPDATE public.device_appeals
     SET status = 'rejected',
         resolved_by = auth.uid(),
         resolved_at = now(),
         next_allowed_at = now() + interval '7 days'
   WHERE id = _appeal_id AND status = 'pending';
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_admin_reject_appeal(uuid) TO authenticated, service_role;
