
-- A direct client call uses role 'authenticated' or 'anon'.
-- A SECURITY DEFINER function runs as its owner (typically 'postgres'/'supabase_admin'),
-- and service_role bypasses RLS entirely. We treat anything that ISN'T a direct
-- authenticated/anon client call as privileged.
CREATE OR REPLACE FUNCTION public.is_privileged_caller()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _role text := current_user;
  _uid uuid;
BEGIN
  -- Inside SECURITY DEFINER functions, current_user is the function owner (e.g. postgres).
  -- Direct API calls run as 'authenticated' or 'anon'.
  IF _role NOT IN ('authenticated','anon') THEN
    RETURN true;
  END IF;

  -- Direct call: only allow if caller is an admin
  _uid := auth.uid();
  IF _uid IS NULL THEN RETURN true; END IF;
  BEGIN RETURN public.is_admin(_uid);
  EXCEPTION WHEN OTHERS THEN RETURN false;
  END;
END;
$$;
