
-- 1. Tables for device/IP-scoped mutes
CREATE TABLE IF NOT EXISTS public.chat_mute_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  mute_id uuid REFERENCES public.chat_mutes(id) ON DELETE CASCADE,
  source_user_id uuid,
  reason text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.chat_mute_devices TO authenticated;
GRANT ALL ON public.chat_mute_devices TO service_role;
ALTER TABLE public.chat_mute_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmd_admin_manage ON public.chat_mute_devices;
CREATE POLICY cmd_admin_manage ON public.chat_mute_devices
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_chat_mod(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_chat_mod(auth.uid()));
CREATE INDEX IF NOT EXISTS chat_mute_devices_dev_active_idx
  ON public.chat_mute_devices(device_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.chat_mute_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  mute_id uuid REFERENCES public.chat_mutes(id) ON DELETE CASCADE,
  source_user_id uuid,
  reason text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.chat_mute_ips TO authenticated;
GRANT ALL ON public.chat_mute_ips TO service_role;
ALTER TABLE public.chat_mute_ips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmi_admin_manage ON public.chat_mute_ips;
CREATE POLICY cmi_admin_manage ON public.chat_mute_ips
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_chat_mod(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_chat_mod(auth.uid()));
CREATE INDEX IF NOT EXISTS chat_mute_ips_ip_active_idx
  ON public.chat_mute_ips(ip) WHERE active;

-- 2. Trigger: when a chat_mutes row is inserted/updated, fan out to device + ip tables
CREATE OR REPLACE FUNCTION public.sync_chat_mute_devices_ips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    INSERT INTO public.chat_mute_ips(ip, mute_id, source_user_id, reason, active, expires_at)
    SELECT DISTINCT ui.ip, NEW.id, NEW.user_id, NEW.reason, true, NEW.expires_at
    FROM public.user_ips ui
    WHERE ui.user_id = NEW.user_id AND ui.ip IS NOT NULL AND length(ui.ip) > 0;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.active = false AND OLD.active = true THEN
      UPDATE public.chat_mute_devices SET active = false WHERE mute_id = NEW.id;
      UPDATE public.chat_mute_ips     SET active = false WHERE mute_id = NEW.id;
    ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      UPDATE public.chat_mute_devices SET expires_at = NEW.expires_at WHERE mute_id = NEW.id;
      UPDATE public.chat_mute_ips     SET expires_at = NEW.expires_at WHERE mute_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chat_mute_devices_ips ON public.chat_mutes;
CREATE TRIGGER trg_sync_chat_mute_devices_ips
AFTER INSERT OR UPDATE ON public.chat_mutes
FOR EACH ROW EXECUTE FUNCTION public.sync_chat_mute_devices_ips();

-- 3. Backfill existing active mutes
INSERT INTO public.chat_mute_devices(device_id, mute_id, source_user_id, reason, active, expires_at)
SELECT DISTINCT da.device_id, cm.id, cm.user_id, cm.reason, true, cm.expires_at
FROM public.chat_mutes cm
JOIN public.device_accounts da ON da.user_id = cm.user_id
WHERE cm.active = true
  AND (cm.expires_at IS NULL OR cm.expires_at > now())
  AND da.device_id IS NOT NULL AND length(da.device_id) > 0
ON CONFLICT DO NOTHING;

INSERT INTO public.chat_mute_ips(ip, mute_id, source_user_id, reason, active, expires_at)
SELECT DISTINCT ui.ip, cm.id, cm.user_id, cm.reason, true, cm.expires_at
FROM public.chat_mutes cm
JOIN public.user_ips ui ON ui.user_id = cm.user_id
WHERE cm.active = true
  AND (cm.expires_at IS NULL OR cm.expires_at > now())
  AND ui.ip IS NOT NULL AND length(ui.ip) > 0
ON CONFLICT DO NOTHING;

-- 4. Update is_muted to also consider device/ip-scoped mutes for the current user
CREATE OR REPLACE FUNCTION public.is_muted(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_mute_ips cmi
      JOIN public.user_ips ui ON ui.ip = cmi.ip
      WHERE ui.user_id = _user
        AND cmi.active = true
        AND (cmi.expires_at IS NULL OR cmi.expires_at > now())
    );
$$;

-- 5. Update send_chat_message_safe to return mute info from device/ip scope as well
CREATE OR REPLACE FUNCTION public.send_chat_message_safe(
  _channel text,
  _body text,
  _recipient_id uuid DEFAULT NULL,
  _tribe_id uuid DEFAULT NULL,
  _reply_to_id uuid DEFAULT NULL,
  _reply_to_body text DEFAULT NULL,
  _reply_to_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg_id uuid;
  _body text := btrim(COALESCE(_body, ''));
  _mute_reason text;
  _mute_expires timestamptz;
  _mlevel int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body) = 0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body) > 500 THEN _body := left(_body, 500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'moderator')) THEN
    SELECT COALESCE(level, 1) INTO _mlevel FROM public.user_market WHERE user_id = _uid;
    IF COALESCE(_mlevel, 1) < 6 THEN
      RETURN jsonb_build_object(
        'status', 'level_locked',
        'required_level', 6,
        'current_level', COALESCE(_mlevel, 1),
        'message', 'لا تقدر ترسل في الشات إلا بعد وصول سوق السفن للمستوى 6'
      );
    END IF;
  END IF;

  -- Direct mute on user
  SELECT reason, expires_at INTO _mute_reason, _mute_expires
  FROM public.chat_mutes
  WHERE user_id = _uid
    AND active = true
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Device-scoped mute
    SELECT cmd.reason, cmd.expires_at INTO _mute_reason, _mute_expires
    FROM public.chat_mute_devices cmd
    JOIN public.device_accounts da ON da.device_id = cmd.device_id
    WHERE da.user_id = _uid
      AND cmd.active = true
      AND (cmd.expires_at IS NULL OR cmd.expires_at > now())
    ORDER BY cmd.created_at DESC
    LIMIT 1;
  END IF;

  IF _mute_reason IS NULL AND _mute_expires IS NULL THEN
    -- IP-scoped mute
    SELECT cmi.reason, cmi.expires_at INTO _mute_reason, _mute_expires
    FROM public.chat_mute_ips cmi
    JOIN public.user_ips ui ON ui.ip = cmi.ip
    WHERE ui.user_id = _uid
      AND cmi.active = true
      AND (cmi.expires_at IS NULL OR cmi.expires_at > now())
    ORDER BY cmi.created_at DESC
    LIMIT 1;
  END IF;

  IF _mute_reason IS NOT NULL OR _mute_expires IS NOT NULL OR public.is_muted(_uid) THEN
    RETURN jsonb_build_object(
      'status', 'muted_already',
      'reason', COALESCE(_mute_reason, ''),
      'expires_at', _mute_expires,
      'message', 'أنت مكتوم حالياً'
    );
  END IF;

  IF _channel = 'tribe' THEN
    IF _tribe_id IS NULL OR NOT public.is_tribe_member(_uid, _tribe_id) THEN
      RAISE EXCEPTION 'not tribe member';
    END IF;
  ELSIF _channel = 'dm' THEN
    IF _recipient_id IS NULL OR _recipient_id = _uid THEN
      RAISE EXCEPTION 'bad recipient';
    END IF;
  END IF;

  INSERT INTO public.messages(channel, body, sender_id, recipient_id, tribe_id,
                              reply_to_id, reply_to_body, reply_to_name)
  VALUES (_channel, _body, _uid,
          CASE WHEN _channel='dm' THEN _recipient_id ELSE NULL END,
          CASE WHEN _channel='tribe' THEN _tribe_id ELSE NULL END,
          _reply_to_id,
          left(COALESCE(_reply_to_body,''), 200),
          left(COALESCE(_reply_to_name,''), 60))
  RETURNING id INTO _msg_id;

  RETURN jsonb_build_object('status', 'sent', 'id', _msg_id, 'message_id', _msg_id);
END;
$$;
