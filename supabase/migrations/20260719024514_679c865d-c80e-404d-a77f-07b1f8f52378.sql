
-- Block redeeming the same code twice from the same physical device (any account).
CREATE OR REPLACE FUNCTION public.redeem_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row  public.redemption_codes%ROWTYPE;
  v_norm text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_norm := upper(regexp_replace(COALESCE(p_code, ''), '[\s-]+', '', 'g'));
  SELECT * INTO v_row FROM public.redemption_codes
   WHERE upper(regexp_replace(code, '[\s-]+', '', 'g')) = v_norm
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF NOT v_row.active THEN RAISE EXCEPTION 'code_disabled'; END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF v_row.max_uses > 0 AND v_row.uses_count >= v_row.max_uses THEN RAISE EXCEPTION 'code_exhausted'; END IF;
  IF EXISTS (SELECT 1 FROM public.code_redemptions WHERE code_id = v_row.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;
  -- Same-device guard: reject if any account tied to any of this user's devices already redeemed this code.
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

  -- Delegate the actual reward granting to the original implementation.
  RETURN public.redeem_code_impl(v_row.id, v_user);
END;
$function$;
