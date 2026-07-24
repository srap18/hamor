
-- 1) Cooldown table for rejected/canceled friend requests
CREATE TABLE IF NOT EXISTS public.friend_request_cooldown (
  requester_id uuid NOT NULL,
  addressee_id uuid NOT NULL,
  until_at timestamptz NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);
GRANT SELECT ON public.friend_request_cooldown TO authenticated;
GRANT ALL ON public.friend_request_cooldown TO service_role;
ALTER TABLE public.friend_request_cooldown ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cooldown_select_involved" ON public.friend_request_cooldown
  FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- 2) Performance indexes
CREATE INDEX IF NOT EXISTS friends_requester_created_idx
  ON public.friends (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS friend_cooldown_until_idx
  ON public.friend_request_cooldown (until_at);

-- 3) Guard trigger: enforced on every INSERT (RLS bypass or not)
CREATE OR REPLACE FUNCTION public.friends_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_daily int;
  v_burst int;
  v_reverse int;
  v_cool timestamptz;
BEGIN
  -- Service role / server: bypass (auth.uid() is null)
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- sender must be the authenticated user (prevents sender_id tampering)
  IF NEW.requester_id <> v_uid THEN
    RAISE EXCEPTION 'FRIEND_SENDER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF NEW.addressee_id = NEW.requester_id THEN
    RAISE EXCEPTION 'FRIEND_SELF_REQUEST' USING ERRCODE = '22023';
  END IF;

  -- Prevent reverse duplicate (unique index covers same direction)
  SELECT count(*) INTO v_reverse FROM public.friends
    WHERE requester_id = NEW.addressee_id AND addressee_id = NEW.requester_id;
  IF v_reverse > 0 THEN
    RAISE EXCEPTION 'FRIEND_ALREADY_EXISTS' USING ERRCODE = '23505';
  END IF;

  -- Cooldown after prior rejection/cancellation
  SELECT until_at INTO v_cool FROM public.friend_request_cooldown
    WHERE requester_id = NEW.requester_id AND addressee_id = NEW.addressee_id;
  IF v_cool IS NOT NULL AND v_cool > now() THEN
    RAISE EXCEPTION 'FRIEND_COOLDOWN_ACTIVE until %', v_cool USING ERRCODE = '22023';
  END IF;

  -- Burst limit: max 5 requests / 60 seconds
  SELECT count(*) INTO v_burst FROM public.friends
    WHERE requester_id = v_uid AND created_at > now() - interval '60 seconds';
  IF v_burst >= 5 THEN
    RAISE EXCEPTION 'FRIEND_BURST_LIMIT' USING ERRCODE = '22023';
  END IF;

  -- Daily limit: max 30 requests / 24 hours
  SELECT count(*) INTO v_daily FROM public.friends
    WHERE requester_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_daily >= 30 THEN
    RAISE EXCEPTION 'FRIEND_DAILY_LIMIT' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friends_guard_insert ON public.friends;
CREATE TRIGGER trg_friends_guard_insert
  BEFORE INSERT ON public.friends
  FOR EACH ROW EXECUTE FUNCTION public.friends_guard_insert();

-- 4) Log cooldown when a pending request is removed (reject/cancel)
CREATE OR REPLACE FUNCTION public.friends_after_delete_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' THEN
    INSERT INTO public.friend_request_cooldown(requester_id, addressee_id, until_at)
    VALUES (OLD.requester_id, OLD.addressee_id, now() + interval '6 hours')
    ON CONFLICT (requester_id, addressee_id)
      DO UPDATE SET until_at = EXCLUDED.until_at;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_friends_after_delete_cooldown ON public.friends;
CREATE TRIGGER trg_friends_after_delete_cooldown
  AFTER DELETE ON public.friends
  FOR EACH ROW EXECUTE FUNCTION public.friends_after_delete_cooldown();
