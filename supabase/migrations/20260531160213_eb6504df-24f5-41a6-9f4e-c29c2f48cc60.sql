
-- Replace admin email: remove old, grant new, and update auto-grant trigger
DELETE FROM public.user_roles
WHERE role = 'admin'
  AND user_id IN (SELECT id FROM auth.users WHERE lower(email) = 'shabik509509@gmail.com');

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE lower(email) = 'fsfs.almzh.509@gmail.com'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.auto_grant_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) IN ('fsfs.almzh.509@gmail.com','ccx1357@gmail.com') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Prevent admins from banning other admins/moderators
CREATE OR REPLACE FUNCTION public.prevent_ban_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(NEW.user_id) THEN
    RAISE EXCEPTION 'لا يمكن حظر مشرف آخر';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_ban_admin_trg ON public.bans;
CREATE TRIGGER prevent_ban_admin_trg
BEFORE INSERT OR UPDATE ON public.bans
FOR EACH ROW EXECUTE FUNCTION public.prevent_ban_admin();

-- Also prevent muting admins in chat
CREATE OR REPLACE FUNCTION public.prevent_mute_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(NEW.user_id) THEN
    RAISE EXCEPTION 'لا يمكن كتم مشرف آخر';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_mute_admin_trg ON public.chat_mutes;
CREATE TRIGGER prevent_mute_admin_trg
BEFORE INSERT OR UPDATE ON public.chat_mutes
FOR EACH ROW EXECUTE FUNCTION public.prevent_mute_admin();
