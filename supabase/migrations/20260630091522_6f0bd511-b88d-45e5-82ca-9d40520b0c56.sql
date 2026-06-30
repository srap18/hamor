
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
  IF TG_TABLE_NAME = 'chat_mutes' THEN
    -- Allow profanity self-mutes
    IF NEW.user_id = auth.uid()
       AND NEW.muted_by = auth.uid()
       AND NEW.reason LIKE 'profanity:%' THEN
      RETURN NEW;
    END IF;
    -- Allow chat moderators (RLS policy enforces 24h cap)
    IF public.is_chat_mod(auth.uid()) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
