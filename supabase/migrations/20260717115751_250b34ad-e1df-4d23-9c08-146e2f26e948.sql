ALTER FUNCTION public.admin_redeem_code_for(text, uuid)
  RENAME TO admin_redeem_code_for_legacy_20260717;

REVOKE ALL ON FUNCTION public.admin_redeem_code_for_legacy_20260717(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_redeem_code_for_legacy_20260717(text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_redeem_code_for(p_code text, p_target_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_row public.redemption_codes%ROWTYPE;
  v_cur_level integer;
  v_cur_expires timestamptz;
  v_new_level integer;
  v_new_expires timestamptz;
  v_cur_elite integer;
  v_cur_elite_expires timestamptz;
  v_new_elite integer;
  v_new_elite_expires timestamptz;
BEGIN
  -- The legacy implementation retains all existing admin checks, reward grants,
  -- redemption accounting, auditing, and player notifications.
  v_result := public.admin_redeem_code_for_legacy_20260717(p_code, p_target_user);

  SELECT * INTO v_row
  FROM public.redemption_codes
  WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  -- Standard VIP reward was previously omitted from the admin grant path.
  IF coalesce(v_row.reward_vip_level, 0) > 0 THEN
    SELECT vip_level, vip_expires_at
      INTO v_cur_level, v_cur_expires
    FROM public.profiles
    WHERE id = p_target_user
    FOR UPDATE;

    IF coalesce(v_cur_level, 0) >= 1
       AND (v_cur_expires IS NULL OR v_cur_expires > now()) THEN
      v_new_level := least(10, v_cur_level + v_row.reward_vip_level);
    ELSE
      v_new_level := least(10, v_row.reward_vip_level);
    END IF;

    IF v_row.reward_vip_days <= 0
       OR (coalesce(v_cur_level, 0) >= 1 AND v_cur_expires IS NULL) THEN
      v_new_expires := NULL;
    ELSE
      v_new_expires := greatest(coalesce(v_cur_expires, now()), now())
                       + make_interval(days => v_row.reward_vip_days);
    END IF;

    UPDATE public.profiles
       SET vip_level = v_new_level,
           vip_expires_at = v_new_expires
     WHERE id = p_target_user;
  END IF;

  -- Elite VIP reward was also omitted, which caused the reported failure.
  IF coalesce(v_row.reward_elite_vip_level, 0) > 0 THEN
    SELECT elite_vip_level, elite_vip_expires_at
      INTO v_cur_elite, v_cur_elite_expires
    FROM public.profiles
    WHERE id = p_target_user
    FOR UPDATE;

    v_new_elite := least(5, greatest(
      coalesce(v_cur_elite, 0),
      v_row.reward_elite_vip_level
    ));

    IF v_row.reward_elite_vip_days <= 0
       OR (coalesce(v_cur_elite, 0) >= 1 AND v_cur_elite_expires IS NULL) THEN
      v_new_elite_expires := NULL;
    ELSE
      v_new_elite_expires := greatest(coalesce(v_cur_elite_expires, now()), now())
                             + make_interval(days => v_row.reward_elite_vip_days);
    END IF;

    UPDATE public.profiles
       SET elite_vip_level = v_new_elite,
           elite_vip_expires_at = v_new_elite_expires
     WHERE id = p_target_user;
  END IF;

  RETURN v_result || jsonb_build_object(
    'vip_level', coalesce(v_row.reward_vip_level, 0),
    'vip_days', coalesce(v_row.reward_vip_days, 0),
    'elite_vip_level', coalesce(v_row.reward_elite_vip_level, 0),
    'elite_vip_days', coalesce(v_row.reward_elite_vip_days, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_redeem_code_for(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_redeem_code_for(text, uuid)
  TO authenticated, service_role;