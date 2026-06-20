
-- 1) Block duplicate emails across auth.users (case-insensitive)
CREATE OR REPLACE FUNCTION public.prevent_duplicate_auth_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email IS NULL OR length(btrim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) = lower(NEW.email)
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'email_already_registered: %', NEW.email
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_auth_email ON auth.users;
CREATE TRIGGER trg_prevent_duplicate_auth_email
BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_auth_email();

-- 2) Admin search by email -> returns matching user ids
CREATE OR REPLACE FUNCTION public.admin_search_player_ids_by_email(_q text)
RETURNS TABLE(id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF _q IS NULL OR length(btrim(_q)) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text
    FROM auth.users u
    WHERE u.email ILIKE '%' || _q || '%'
    LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_player_ids_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_player_ids_by_email(text) TO authenticated;

-- 3) Also expose email on the admin profile fetch helper (for showing email in the player row)
CREATE OR REPLACE FUNCTION public.admin_get_player_email(_uid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE _email text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  SELECT email::text INTO _email FROM auth.users WHERE id = _uid;
  RETURN _email;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_player_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_player_email(uuid) TO authenticated;
