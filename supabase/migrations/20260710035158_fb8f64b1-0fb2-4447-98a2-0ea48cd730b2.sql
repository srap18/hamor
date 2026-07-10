
-- Add fingerprint versioning + audit log to Device Slot System

ALTER TABLE public.device_fingerprints
  ADD COLUMN IF NOT EXISTS fingerprint_version smallint NOT NULL DEFAULT 1;

ALTER TABLE public.device_slots
  ADD COLUMN IF NOT EXISTS fingerprint_version smallint NOT NULL DEFAULT 1;

-- Audit log
CREATE TABLE IF NOT EXISTS public.device_slot_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  hardware_hash text,
  user_id uuid,
  actor_id uuid,
  fingerprint_version smallint,
  slot_index smallint,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsa_hw ON public.device_slot_audit (hardware_hash);
CREATE INDEX IF NOT EXISTS idx_dsa_user ON public.device_slot_audit (user_id);
CREATE INDEX IF NOT EXISTS idx_dsa_type ON public.device_slot_audit (event_type);
CREATE INDEX IF NOT EXISTS idx_dsa_created ON public.device_slot_audit (created_at DESC);

GRANT SELECT ON public.device_slot_audit TO authenticated;
GRANT ALL ON public.device_slot_audit TO service_role;
ALTER TABLE public.device_slot_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_reads_audit" ON public.device_slot_audit FOR SELECT TO authenticated
  USING (public.device_is_privileged(auth.uid()));

CREATE OR REPLACE FUNCTION public.device_audit_log(
  _event text, _hw text, _user uuid, _actor uuid,
  _version smallint, _slot smallint, _details jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.device_slot_audit (event_type, hardware_hash, user_id, actor_id, fingerprint_version, slot_index, details)
  VALUES (_event, _hw, _user, _actor, _version, _slot, COALESCE(_details, '{}'::jsonb));
$$;

-- ============ Rewrite RPCs to log events + support versioning ============

CREATE OR REPLACE FUNCTION public.device_slot_check(
  _hardware_hash text,
  _user_id uuid DEFAULT NULL,
  _email text DEFAULT NULL,
  _fingerprint_version smallint DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_existing record;
  v_slots jsonb;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 THEN
    RETURN jsonb_build_object('action','allowed','reason','no_fingerprint');
  END IF;

  IF _user_id IS NOT NULL AND public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('action','allowed','reason','privileged');
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.device_slots
     WHERE hardware_hash = _hardware_hash AND user_id = _user_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'action','allowed','reason','existing_slot',
        'slot_index', v_existing.slot_index,
        'locked_until', v_existing.locked_until
      );
    END IF;
  END IF;

  SELECT count(*)::int INTO v_count FROM public.device_slots WHERE hardware_hash = _hardware_hash;

  IF v_count < 2 THEN
    RETURN jsonb_build_object('action','needs_confirmation','free_slots', 2 - v_count);
  END IF;

  SELECT jsonb_agg(jsonb_build_object('slot_index', s.slot_index, 'user_id', s.user_id, 'locked_until', s.locked_until))
    INTO v_slots FROM public.device_slots s WHERE s.hardware_hash = _hardware_hash;

  PERFORM public.device_audit_log(
    'login_blocked_third_account', _hardware_hash, _user_id, _user_id,
    _fingerprint_version, NULL,
    jsonb_build_object('email', _email, 'existing_slots', v_slots)
  );

  RETURN jsonb_build_object('action','blocked','reason','slots_full','slots', v_slots);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_slot_check(text, uuid, text, smallint) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.device_assign_slot(
  _hardware_hash text,
  _user_id uuid,
  _fingerprint_version smallint DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_next_slot smallint;
  v_existing record;
  v_locked_until timestamptz;
  v_is_replacement boolean := false;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 OR _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','bad_input');
  END IF;
  IF public.device_is_privileged(_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'privileged', true);
  END IF;

  SELECT * INTO v_existing FROM public.device_slots
    WHERE hardware_hash = _hardware_hash AND user_id = _user_id;
  IF FOUND THEN
    -- If lock expired, refresh
    IF v_existing.locked_until <= now() THEN
      UPDATE public.device_slots
         SET assigned_at = now(),
             locked_until = now() + interval '14 days',
             fingerprint_version = _fingerprint_version
       WHERE id = v_existing.id
       RETURNING locked_until INTO v_locked_until;
      PERFORM public.device_audit_log(
        'slot_renewed_after_lock', _hardware_hash, _user_id, _user_id,
        _fingerprint_version, v_existing.slot_index, '{}'::jsonb
      );
      RETURN jsonb_build_object('ok', true, 'slot_index', v_existing.slot_index, 'locked_until', v_locked_until, 'renewed', true);
    END IF;
    RETURN jsonb_build_object('ok', true, 'slot_index', v_existing.slot_index, 'locked_until', v_existing.locked_until);
  END IF;

  SELECT count(*)::int INTO v_count FROM public.device_slots WHERE hardware_hash = _hardware_hash;
  IF v_count >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'error','slots_full');
  END IF;

  v_next_slot := CASE
    WHEN NOT EXISTS(SELECT 1 FROM public.device_slots WHERE hardware_hash = _hardware_hash AND slot_index = 1) THEN 1
    ELSE 2 END;

  INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
  VALUES (_hardware_hash, v_next_slot, _user_id, now(), now() + interval '14 days', _fingerprint_version)
  ON CONFLICT (hardware_hash, user_id) DO NOTHING
  RETURNING slot_index, locked_until INTO v_next_slot, v_locked_until;

  PERFORM public.device_audit_log(
    'slot_created', _hardware_hash, _user_id, _user_id,
    _fingerprint_version, v_next_slot, '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'slot_index', v_next_slot, 'locked_until', v_locked_until);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_assign_slot(text, uuid, smallint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.device_migrate_choose(
  _hardware_hash text,
  _user_a uuid,
  _user_b uuid,
  _fingerprint_version smallint DEFAULT 1
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

  INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
  VALUES (_hardware_hash, 1, _user_a, now(), now() + interval '14 days', _fingerprint_version)
  ON CONFLICT DO NOTHING;

  IF _user_b IS NOT NULL AND _user_b <> _user_a THEN
    INSERT INTO public.device_slots (hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
    VALUES (_hardware_hash, 2, _user_b, now(), now() + interval '14 days', _fingerprint_version)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.device_audit_log(
    'legacy_migration', _hardware_hash, _user_a, _user_a,
    _fingerprint_version, NULL,
    jsonb_build_object('user_a', _user_a, 'user_b', _user_b)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_migrate_choose(text, uuid, uuid, smallint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.device_submit_appeal(
  _hardware_hash text,
  _email text,
  _message text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending record;
  v_recent_reject record;
  v_id uuid;
BEGIN
  IF _hardware_hash IS NULL OR length(_hardware_hash) < 16 OR _message IS NULL OR length(trim(_message)) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error','bad_input');
  END IF;

  SELECT * INTO v_pending FROM public.device_appeals
   WHERE hardware_hash = _hardware_hash AND status = 'pending' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error','already_pending');
  END IF;

  SELECT * INTO v_recent_reject FROM public.device_appeals
   WHERE hardware_hash = _hardware_hash AND status = 'rejected'
   ORDER BY resolved_at DESC LIMIT 1;
  IF FOUND AND v_recent_reject.next_allowed_at IS NOT NULL AND v_recent_reject.next_allowed_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error','cooldown', 'next_allowed_at', v_recent_reject.next_allowed_at);
  END IF;

  INSERT INTO public.device_appeals (hardware_hash, email, message, status)
  VALUES (_hardware_hash, _email, substr(_message, 1, 2000), 'pending')
  RETURNING id INTO v_id;

  PERFORM public.device_audit_log(
    'appeal_submitted', _hardware_hash, NULL, NULL, NULL, NULL,
    jsonb_build_object('appeal_id', v_id, 'email', _email)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_submit_appeal(text, text, text) TO authenticated, anon, service_role;

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

  PERFORM public.device_audit_log(
    'appeal_approved_slots_reset', v_appeal.hardware_hash, v_appeal.user_id, auth.uid(),
    NULL, NULL, jsonb_build_object('appeal_id', _appeal_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_admin_approve_appeal(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.device_admin_reject_appeal(
  _appeal_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hw text;
BEGIN
  IF NOT public.device_is_privileged(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error','forbidden');
  END IF;
  UPDATE public.device_appeals
     SET status = 'rejected',
         resolved_by = auth.uid(),
         resolved_at = now(),
         next_allowed_at = now() + interval '7 days'
   WHERE id = _appeal_id AND status = 'pending'
   RETURNING hardware_hash INTO v_hw;

  IF v_hw IS NOT NULL THEN
    PERFORM public.device_audit_log(
      'appeal_rejected', v_hw, NULL, auth.uid(),
      NULL, NULL, jsonb_build_object('appeal_id', _appeal_id, 'cooldown_days', 7)
    );
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.device_admin_reject_appeal(uuid) TO authenticated, service_role;
