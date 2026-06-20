CREATE OR REPLACE FUNCTION public.admin_permanent_ban(_uid uuid, _reason text DEFAULT '')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(_admin) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _uid IS NULL THEN RAISE EXCEPTION 'missing user'; END IF;
  IF _uid = _admin THEN RAISE EXCEPTION 'cannot ban self'; END IF;

  -- Lift any older active ban so the new one is the single source of truth
  UPDATE public.bans SET active = false WHERE user_id = _uid AND active = true;

  INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
  VALUES (_uid, COALESCE(NULLIF(_reason, ''), 'حظر نهائي'), _admin, NULL, true);

  -- IMPORTANT: do NOT touch banned_devices here. The admin asked that
  -- a permanent ban affect only this auth account, not any device
  -- shared with linked accounts on the same network.

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_admin, 'admin_permanent_ban', _uid, jsonb_build_object('reason', COALESCE(_reason, '')));

  RETURN 0;
END $$;