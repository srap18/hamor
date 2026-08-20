CREATE OR REPLACE FUNCTION public.device_admin_approve_appeal(_appeal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_appeal record;
  v_unbanned int := 0;
BEGIN
  IF NOT public.device_is_privileged(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error','forbidden');
  END IF;
  SELECT * INTO v_appeal FROM public.device_appeals WHERE id = _appeal_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','not_found'); END IF;

  -- Free the two account slots on this device
  DELETE FROM public.device_slots WHERE hardware_hash = v_appeal.hardware_hash;

  -- Lift the device ban itself — otherwise device_slot_check keeps returning
  -- 'device_banned' and the player stays locked out no matter how many
  -- appeals get approved.
  DELETE FROM public.banned_devices WHERE device_id = v_appeal.hardware_hash;
  GET DIAGNOSTICS v_unbanned = ROW_COUNT;

  -- Clear the "too many attempts" throttle so he can sign in right away
  DELETE FROM public.device_slot_rate_limit WHERE hardware_hash = v_appeal.hardware_hash;

  UPDATE public.device_appeals
     SET status = 'approved', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = _appeal_id;

  PERFORM public.device_audit_log(
    'appeal_approved_slots_reset', v_appeal.hardware_hash, v_appeal.user_id, auth.uid(),
    NULL, NULL, jsonb_build_object('appeal_id', _appeal_id, 'device_unbanned', v_unbanned)
  );

  RETURN jsonb_build_object('ok', true, 'device_unbanned', v_unbanned);
END;
$function$;

-- Retro-fix: devices whose appeal was approved but are still banned.
DELETE FROM public.banned_devices bd
 WHERE EXISTS (
   SELECT 1 FROM public.device_appeals a
    WHERE a.hardware_hash = bd.device_id
      AND a.status = 'approved'
      AND a.resolved_at > now() - interval '7 days'
 );

DELETE FROM public.device_slot_rate_limit rl
 WHERE EXISTS (
   SELECT 1 FROM public.device_appeals a
    WHERE a.hardware_hash = rl.hardware_hash
      AND a.status = 'approved'
      AND a.resolved_at > now() - interval '7 days'
 );