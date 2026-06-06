CREATE OR REPLACE FUNCTION public.guard_messages_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow elevated/trusted contexts (e.g. SECURITY DEFINER triggers like prune, service role, admins)
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN OLD;
  END IF;
  IF auth.role() = 'service_role' THEN
    RETURN OLD;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF OLD.sender_id = auth.uid() OR public.is_admin(auth.uid()) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'not_authorized_to_delete' USING ERRCODE = '42501';
END;
$function$;