CREATE OR REPLACE FUNCTION public.admin_set_username(_target uuid, _new text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v text;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  v := lower(trim(_new));
  IF v !~ '^[a-z0-9_]{1,20}$' THEN RAISE EXCEPTION 'INVALID_USERNAME'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v AND id <> _target) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;
  UPDATE public.profiles SET username = v, username_changed_at = now() WHERE id = _target;
  RETURN jsonb_build_object('username', v);
END;
$function$;