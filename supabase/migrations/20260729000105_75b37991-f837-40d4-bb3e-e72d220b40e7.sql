
-- 1) Prevent clients from tampering with the cooldown timestamps.
CREATE OR REPLACE FUNCTION public._protect_name_cooldown_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow SECURITY DEFINER server functions and admin roles
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.username_changed_at IS DISTINCT FROM OLD.username_changed_at THEN
    RAISE EXCEPTION 'username_changed_at is read-only from the client';
  END IF;
  IF NEW.display_name_changed_at IS DISTINCT FROM OLD.display_name_changed_at THEN
    RAISE EXCEPTION 'display_name_changed_at is read-only from the client';
  END IF;
  IF NEW.free_name_change_available IS DISTINCT FROM OLD.free_name_change_available THEN
    RAISE EXCEPTION 'free_name_change_available is read-only from the client';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_name_cooldown_columns ON public.profiles;
CREATE TRIGGER protect_name_cooldown_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public._protect_name_cooldown_columns();

-- 2) Serialize username changes per user and re-check under lock (server clock only).
CREATE OR REPLACE FUNCTION public.change_username(_new text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text;
  last_at timestamptz;
  next_at timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Per-user advisory lock (transaction-scoped) blocks concurrent double submits.
  PERFORM pg_advisory_xact_lock(hashtextextended('change_username:' || uid::text, 0));

  cleaned := lower(trim(_new));
  IF cleaned !~ '^[a-z0-9_]{5,20}$' THEN RAISE EXCEPTION 'INVALID_USERNAME'; END IF;

  -- Read latest value under lock so a racing call sees the just-written timestamp.
  SELECT username_changed_at INTO last_at
    FROM public.profiles
    WHERE id = uid
    FOR UPDATE;

  IF last_at IS NOT NULL AND last_at > now() - interval '14 days' THEN
    next_at := last_at + interval '14 days';
    RAISE EXCEPTION 'USERNAME_COOLDOWN' USING HINT = next_at::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = cleaned AND id <> uid) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  UPDATE public.profiles
     SET username = cleaned,
         username_changed_at = now()
   WHERE id = uid;

  RETURN jsonb_build_object('ok', true, 'username', cleaned, 'changed_at', now());
END; $$;
