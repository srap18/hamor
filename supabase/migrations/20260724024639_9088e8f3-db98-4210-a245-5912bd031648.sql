
CREATE OR REPLACE FUNCTION public.redeem_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row public.redemption_codes%ROWTYPE;
  v_norm text;
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_norm := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]+', '', 'g'));

  SELECT * INTO v_row
  FROM public.redemption_codes
  WHERE upper(regexp_replace(code, '[\s-]+', '', 'g')) = v_norm
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF NOT v_row.active THEN RAISE EXCEPTION 'code_disabled'; END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF v_row.max_uses > 0 AND v_row.uses_count >= v_row.max_uses THEN RAISE EXCEPTION 'code_exhausted'; END IF;

  -- One use per account always.
  IF EXISTS (
    SELECT 1 FROM public.code_redemptions
    WHERE code_id = v_row.id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  -- Same-device guard applies ONLY to strictly single-recipient codes (max_uses = 1),
  -- which are personal/private codes. Public codes (max_uses > 1 or unlimited = 0)
  -- can be redeemed once per account regardless of shared devices.
  IF v_row.max_uses = 1 THEN
    IF EXISTS (
      SELECT 1
      FROM public.device_slots ds_me
      JOIN public.device_slots ds_other ON ds_other.hardware_hash = ds_me.hardware_hash
      JOIN public.code_redemptions cr ON cr.user_id = ds_other.user_id
      WHERE ds_me.user_id = v_user
        AND ds_other.user_id <> v_user
        AND cr.code_id = v_row.id
    ) THEN
      RAISE EXCEPTION 'already_redeemed_on_this_device';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.device_history dh_me
      JOIN public.device_history dh_other ON dh_other.device_id = dh_me.device_id
      JOIN public.code_redemptions cr ON cr.user_id = dh_other.user_id
      WHERE dh_me.user_id = v_user
        AND dh_other.user_id <> v_user
        AND cr.code_id = v_row.id
        AND length(dh_me.device_id) >= 32
        AND length(dh_other.device_id) >= 32
    ) THEN
      RAISE EXCEPTION 'already_redeemed_on_this_device';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.device_accounts da_me
      JOIN public.device_accounts da_other ON da_other.device_id = da_me.device_id
      JOIN public.code_redemptions cr ON cr.user_id = da_other.user_id
      WHERE da_me.user_id = v_user
        AND da_other.user_id <> v_user
        AND cr.code_id = v_row.id
    ) THEN
      RAISE EXCEPTION 'already_redeemed_on_this_device';
    END IF;
  END IF;

  -- Delegate all reward-granting to the existing internal implementation
  -- by calling the previous body via a helper. Simpler: re-run the original grant path
  -- by invoking the pre-existing logic still stored in redeem_code_grant.
  SELECT public.redeem_code_grant(v_user, v_row.id) INTO v_result;
  RETURN v_result;
END;
$function$;
