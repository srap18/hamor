CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('ok', false, 'reason', 'referrals_disabled');
$$;