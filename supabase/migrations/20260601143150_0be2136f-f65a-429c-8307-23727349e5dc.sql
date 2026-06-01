
-- 1) Tribe max 7 members trigger
CREATE OR REPLACE FUNCTION public.enforce_tribe_member_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.tribe_members WHERE tribe_id = NEW.tribe_id;
  IF v_count >= 7 THEN
    RAISE EXCEPTION 'tribe full (max 7 members)';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_tribe_member_limit ON public.tribe_members;
CREATE TRIGGER trg_enforce_tribe_member_limit
  BEFORE INSERT ON public.tribe_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tribe_member_limit();

-- 2) Active session id on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_session_id text;

CREATE OR REPLACE FUNCTION public.claim_session(_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'invalid token'; END IF;
  UPDATE public.profiles SET active_session_id = _token WHERE id = auth.uid();
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_session(text) TO authenticated;

-- 3) Device <-> account binding (one account per device, admin exempt)
CREATE TABLE IF NOT EXISTS public.device_accounts (
  device_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_accounts_user ON public.device_accounts(user_id);

GRANT SELECT ON public.device_accounts TO authenticated;
GRANT ALL ON public.device_accounts TO service_role;

ALTER TABLE public.device_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS da_select_own ON public.device_accounts;
CREATE POLICY da_select_own ON public.device_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.register_device(_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_user uuid;
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _device_id IS NULL OR length(_device_id) < 8 THEN RAISE EXCEPTION 'invalid device id'; END IF;

  v_is_admin := public.is_admin(v_uid);

  -- Admins skip enforcement (can use any device with any account)
  IF v_is_admin THEN
    INSERT INTO public.device_accounts(device_id, user_id)
      VALUES (_device_id, v_uid)
      ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'admin', true);
  END IF;

  -- Check if device already bound to another user
  SELECT user_id INTO v_existing_user FROM public.device_accounts WHERE device_id = _device_id;
  IF v_existing_user IS NOT NULL AND v_existing_user <> v_uid THEN
    -- Check if the other owner is admin → allow override
    IF public.is_admin(v_existing_user) THEN
      -- Admin used this device before; allow rebinding
      UPDATE public.device_accounts SET user_id = v_uid, updated_at = now() WHERE device_id = _device_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RAISE EXCEPTION 'device already bound to another account';
  END IF;

  -- Check if this user already bound to another device
  IF EXISTS (SELECT 1 FROM public.device_accounts WHERE user_id = v_uid AND device_id <> _device_id) THEN
    RAISE EXCEPTION 'account already bound to another device';
  END IF;

  INSERT INTO public.device_accounts(device_id, user_id)
    VALUES (_device_id, v_uid)
    ON CONFLICT (device_id) DO UPDATE SET user_id = v_uid, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.register_device(text) TO authenticated;
