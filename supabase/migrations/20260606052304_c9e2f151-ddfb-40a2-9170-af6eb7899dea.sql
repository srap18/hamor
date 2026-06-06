
-- Defense-in-depth: triggers that block non-admins from inserting into bans/chat_mutes/admin_audit
-- and from deleting messages they don't own. RLS already enforces this; these triggers are belt-and-suspenders.

CREATE OR REPLACE FUNCTION public.guard_admin_only_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bans_insert ON public.bans;
CREATE TRIGGER trg_guard_bans_insert
  BEFORE INSERT OR UPDATE ON public.bans
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_only_insert();

DROP TRIGGER IF EXISTS trg_guard_chat_mutes_insert ON public.chat_mutes;
CREATE TRIGGER trg_guard_chat_mutes_insert
  BEFORE INSERT OR UPDATE ON public.chat_mutes
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_only_insert();

-- admin_audit: also enforce that admin_id matches the caller (no spoofing other admins)
CREATE OR REPLACE FUNCTION public.guard_admin_audit_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF NEW.admin_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'admin_id_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_admin_audit_insert ON public.admin_audit;
CREATE TRIGGER trg_guard_admin_audit_insert
  BEFORE INSERT ON public.admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_audit_insert();

-- messages: prevent users from deleting other users' messages (only admins or the sender)
CREATE OR REPLACE FUNCTION public.guard_messages_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
$$;

DROP TRIGGER IF EXISTS trg_guard_messages_delete ON public.messages;
CREATE TRIGGER trg_guard_messages_delete
  BEFORE DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_messages_delete();

-- notifications: enforce that non-admins cannot create notifications (RLS already blocks INSERT
-- to non-admins, but add a trigger for defense-in-depth in case a future policy is relaxed).
CREATE OR REPLACE FUNCTION public.guard_notifications_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_notifications_insert ON public.notifications;
CREATE TRIGGER trg_guard_notifications_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_notifications_insert();
