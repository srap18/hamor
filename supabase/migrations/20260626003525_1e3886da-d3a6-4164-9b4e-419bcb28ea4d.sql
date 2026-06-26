
-- 1) Wipe all IP-based bans and IP-based chat mutes
TRUNCATE TABLE public.banned_ips;
TRUNCATE TABLE public.chat_mute_ips;

-- 2) Stop hard-ban from inserting IP bans
CREATE OR REPLACE FUNCTION public.admin_hard_ban(_uid uuid, _reason text DEFAULT ''::text, _admin uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := COALESCE(_admin, auth.uid());
  _email text;
  _devices int := 0;
BEGIN
  IF _caller IS NULL OR NOT public.is_admin(_caller) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _uid IS NULL THEN RAISE EXCEPTION 'missing user'; END IF;
  IF _uid = _caller THEN RAISE EXCEPTION 'cannot ban self'; END IF;

  SELECT lower(email) INTO _email FROM auth.users WHERE id = _uid;

  IF _email IS NOT NULL THEN
    INSERT INTO public.banned_emails(email, reason, banned_by)
    VALUES (_email, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller)
    ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
  END IF;

  WITH ins AS (
    INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
    SELECT da.device_id, _uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller
    FROM public.device_accounts da WHERE da.user_id = _uid
    ON CONFLICT (device_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by
    RETURNING 1
  ) SELECT count(*) INTO _devices FROM ins;

  UPDATE public.bans SET active = false WHERE user_id = _uid AND active = true;
  INSERT INTO public.bans(user_id, reason, banned_by, expires_at, active)
  VALUES (_uid, COALESCE(NULLIF(_reason,''),'حظر قوي'), _caller, NULL, true);

  UPDATE public.profiles SET active_session_id = 'banned-'||extract(epoch from now())::bigint::text
    WHERE id = _uid;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (_caller, 'admin_hard_ban', _uid,
    jsonb_build_object('reason', COALESCE(_reason,''), 'email', _email, 'devices_banned', _devices));

  RETURN jsonb_build_object('ok', true, 'email', _email, 'devices', _devices, 'ips', 0);
END $function$;

-- 3) Mute check no longer scans by IP
CREATE OR REPLACE FUNCTION public.is_muted(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.chat_mutes
      WHERE user_id = _user
        AND active = true
        AND (expires_at IS NULL OR expires_at > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_mute_devices cmd
      JOIN public.device_accounts da ON da.device_id = cmd.device_id
      WHERE da.user_id = _user
        AND cmd.active = true
        AND (cmd.expires_at IS NULL OR cmd.expires_at > now())
    );
$function$;

-- 4) Trigger no longer fans a chat mute out across every IP the user has used
CREATE OR REPLACE FUNCTION public.sync_chat_mute_devices_ips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.active = true THEN
    INSERT INTO public.chat_mute_devices(device_id, mute_id, source_user_id, reason, active, expires_at)
    SELECT DISTINCT da.device_id, NEW.id, NEW.user_id, NEW.reason, true, NEW.expires_at
    FROM public.device_accounts da
    WHERE da.user_id = NEW.user_id AND da.device_id IS NOT NULL AND length(da.device_id) > 0;

    INSERT INTO public.chat_mute_devices(device_id, mute_id, source_user_id, reason, active, expires_at)
    SELECT DISTINCT dh.device_id, NEW.id, NEW.user_id, NEW.reason, true, NEW.expires_at
    FROM public.device_history dh
    WHERE dh.user_id = NEW.user_id AND dh.device_id IS NOT NULL AND length(dh.device_id) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_mute_devices cmd
        WHERE cmd.mute_id = NEW.id AND cmd.device_id = dh.device_id
      );

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.active = false AND OLD.active = true THEN
      UPDATE public.chat_mute_devices SET active = false WHERE mute_id = NEW.id;
    ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      UPDATE public.chat_mute_devices SET expires_at = NEW.expires_at WHERE mute_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
