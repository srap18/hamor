CREATE OR REPLACE FUNCTION public.guard_notifications_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ctx text;
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF current_setting('app.allow_notif', true) = 'true' THEN RETURN NEW; END IF;

  -- The support implementation is a validated SECURITY DEFINER RPC.  Allow
  -- only notifications emitted from that trusted call stack, avoiding a
  -- fragile dependency on transaction-local settings in pooled sessions.
  GET DIAGNOSTICS _ctx = PG_CONTEXT;
  IF NEW.kind = 'support'
     AND NEW.created_by = auth.uid()
     AND position('PL/pgSQL function send_support_impl' IN COALESCE(_ctx, '')) > 0 THEN
    RETURN NEW;
  END IF;

  IF public.is_chat_mod(auth.uid()) AND NEW.kind = 'warning' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_support_impl(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO service_role;