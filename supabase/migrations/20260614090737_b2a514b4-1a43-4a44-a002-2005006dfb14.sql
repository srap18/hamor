
-- Many-to-many device tracking (so linked-accounts works)
CREATE TABLE IF NOT EXISTS public.device_history (
  device_id  text NOT NULL,
  user_id    uuid NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  hits       int NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, user_id)
);
CREATE INDEX IF NOT EXISTS device_history_device_idx ON public.device_history(device_id);
CREATE INDEX IF NOT EXISTS device_history_user_idx ON public.device_history(user_id);

GRANT SELECT ON public.device_history TO authenticated;
GRANT ALL ON public.device_history TO service_role;
ALTER TABLE public.device_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dh_admin_read ON public.device_history;
CREATE POLICY dh_admin_read ON public.device_history
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR auth.uid() = user_id);

-- Backfill from existing device_accounts
INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
SELECT device_id, user_id, created_at, updated_at, 1
FROM public.device_accounts
ON CONFLICT (device_id, user_id) DO NOTHING;

-- Unified session-touch RPC: records IP and (optionally) device for current user.
-- IP is passed from the server function which reads it from request headers.
CREATE OR REPLACE FUNCTION public.touch_session(_device_id text, _ip text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  IF _ip IS NOT NULL AND length(_ip) BETWEEN 3 AND 64 THEN
    INSERT INTO public.user_ips(user_id, ip, first_seen, last_seen, hits)
    VALUES (v_uid, _ip, now(), now(), 1)
    ON CONFLICT (user_id, ip) DO UPDATE
      SET last_seen = now(), hits = public.user_ips.hits + 1;
  END IF;

  IF _device_id IS NOT NULL AND length(_device_id) BETWEEN 8 AND 160 THEN
    INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
    VALUES (_device_id, v_uid, now(), now(), 1)
    ON CONFLICT (device_id, user_id) DO UPDATE
      SET last_seen = now(), hits = public.device_history.hits + 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_session(text, text) TO authenticated, service_role;
