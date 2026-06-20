
-- 1) banned_ips table
CREATE TABLE IF NOT EXISTS public.banned_ips (
  ip text PRIMARY KEY,
  user_id uuid,
  reason text,
  banned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banned_ips TO authenticated;
GRANT ALL ON public.banned_ips TO service_role;
ALTER TABLE public.banned_ips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage banned_ips" ON public.banned_ips;
CREATE POLICY "admins manage banned_ips" ON public.banned_ips
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));

-- 2) helper checks (security definer so anon can ask)
CREATE OR REPLACE FUNCTION public.is_device_banned(_device_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.banned_devices WHERE device_id = _device_id)
$$;

CREATE OR REPLACE FUNCTION public.is_ip_banned(_ip text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.banned_ips WHERE ip = _ip)
$$;

-- 3) one-call preflight for signup/login — returns NULL if allowed, otherwise an Arabic reason
CREATE OR REPLACE FUNCTION public.signup_block_reason(_email text, _device_id text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _email IS NOT NULL AND _email <> '' THEN
    IF EXISTS (SELECT 1 FROM public.banned_emails WHERE email = lower(_email)) THEN
      RETURN 'هذا البريد محظور من إنشاء حساب';
    END IF;
  END IF;
  IF _device_id IS NOT NULL AND _device_id <> '' THEN
    IF EXISTS (SELECT 1 FROM public.banned_devices WHERE device_id = _device_id) THEN
      RETURN 'هذا الجهاز محظور — لا يمكن إنشاء أو دخول حساب منه';
    END IF;
  END IF;
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.is_device_banned(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_ip_banned(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.signup_block_reason(text, text) TO anon, authenticated;

-- 4) Hard ban: this user's email + every device they ever used + every IP they ever used
CREATE OR REPLACE FUNCTION public.admin_hard_ban(_uid uuid, _reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _admin uuid := auth.uid();
  _email text;
  _devices int := 0;
  _ips int := 0;
BEGIN
  IF NOT public.is_admin(_admin) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _uid IS NULL THEN RAISE EXCEPTION 'missing user'; END IF;
  IF _uid = _admin THEN RAISE EXCEPTION 'cannot ban self'; END IF;

  SELECT lower(email) INTO _email FROM auth.users WHERE id = _uid;

  -- Email ban
  IF _email IS NOT NULL THEN
    INSERT INTO public.banned_emails(email, reason, banned_by)
    VALUES (_email, COALESCE(NULLIF(_reason,''),'حظر قوي'), _admin)
    ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
  END IF;

  -- Device bans (only this user's devices)
  WITH ins AS (
    INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
    SELECT da.device_id, _uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _admin
    FROM public.device_accounts da WHERE da.user_id = _uid
    ON CONFLICT (device_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by
    RETURNING 1
  ) SELECT count(*) INTO _devices FROM ins;

  -- IP bans (only this user's seen IPs)
  WITH ins AS (
    INSERT INTO public.banned_ips(ip, user_id, reason, banned_by)
    SELECT ui.ip, _uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _admin
    FROM public.user_ips ui WHERE ui.user_id = _uid AND ui.ip IS NOT NULL AND ui.ip <> ''
    ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by
    RETURNING 1
  ) SELECT count(*) INTO _ips FROM ins;

  -- Active permanent ban row
  UPDATE public.bans SET active = false WHERE user_id = _uid AND active = true;
  INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
  VALUES (_uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _admin, NULL, true);

  -- Invalidate active session
  UPDATE public.profiles SET active_session_id = 'banned-'||extract(epoch from now())::bigint::text
    WHERE id = _uid;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_admin, 'admin_hard_ban', _uid,
    jsonb_build_object('reason', COALESCE(_reason,''), 'email', _email,
                       'devices_banned', _devices, 'ips_banned', _ips));

  RETURN jsonb_build_object('ok', true, 'email', _email, 'devices', _devices, 'ips', _ips);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_hard_ban(uuid, text) TO authenticated;
