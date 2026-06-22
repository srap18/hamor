
CREATE OR REPLACE FUNCTION public.guard_admin_only_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Allow profanity self-mutes
  IF TG_TABLE_NAME = 'chat_mutes'
     AND NEW.user_id = auth.uid()
     AND NEW.muted_by = auth.uid()
     AND NEW.reason LIKE 'profanity:%' THEN
    RETURN NEW;
  END IF;
  -- Allow chat moderators to insert/update chat_mutes (RLS policy enforces 24h cap)
  IF TG_TABLE_NAME = 'chat_mutes' AND public.is_chat_mod(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_notifications_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.allow_notif', true) = 'true' THEN
    RETURN NEW;
  END IF;
  -- Allow chat moderators to send warning notifications (e.g. mute notice)
  IF public.is_chat_mod(auth.uid()) AND NEW.kind = 'warning' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
