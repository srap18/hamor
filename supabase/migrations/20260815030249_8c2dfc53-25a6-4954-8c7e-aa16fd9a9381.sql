ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_email_verified()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  UPDATE public.profiles
     SET email_verified_at = COALESCE(email_verified_at, now())
   WHERE id = v_uid;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_email_verified() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_email_verified(_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created timestamptz;
  v_conf timestamptz;
  v_marked timestamptz;
  v_cutoff constant timestamptz := timestamptz '2026-08-08 14:00:00+00';
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  SELECT email_verified_at INTO v_marked FROM public.profiles WHERE id = _uid;
  IF v_marked IS NOT NULL THEN RETURN true; END IF;
  SELECT created_at, email_confirmed_at INTO v_created, v_conf FROM auth.users WHERE id = _uid;
  IF v_created IS NULL THEN RETURN false; END IF;
  IF v_created < v_cutoff THEN RETURN true; END IF;
  IF v_conf IS NULL THEN RETURN false; END IF;
  IF abs(extract(epoch FROM (v_conf - v_created))) < 5 THEN RETURN false; END IF;
  RETURN true;
END;
$$;