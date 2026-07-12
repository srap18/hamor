
-- Super admin (فقط أنت) + إدارة المشرفين وصلاحياتهم من DB
CREATE TABLE IF NOT EXISTS public.admin_staff_perms (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  allowed_paths text[] DEFAULT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.admin_staff_perms TO authenticated;
GRANT ALL ON public.admin_staff_perms TO service_role;
ALTER TABLE public.admin_staff_perms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff perms readable by admins" ON public.admin_staff_perms;
CREATE POLICY "staff perms readable by admins" ON public.admin_staff_perms FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));

CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=_uid AND lower(email)='ccx1357@gmail.com');
$$;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- RPC: قائمة كل الطاقم (admin/moderator) — للسوبر فقط
CREATE OR REPLACE FUNCTION public.admin_list_staff()
RETURNS TABLE(user_id uuid, email text, display_name text, roles text[], allowed_paths text[], is_super boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.display_name,
    (SELECT array_agg(r.role::text) FROM public.user_roles r WHERE r.user_id=u.id AND r.role IN ('admin','moderator')),
    sp.allowed_paths,
    public.is_super_admin(u.id)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.admin_staff_perms sp ON sp.user_id=u.id
  WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=u.id AND r.role IN ('admin','moderator'))
  ORDER BY public.is_super_admin(u.id) DESC, u.email;
END;$$;
GRANT EXECUTE ON FUNCTION public.admin_list_staff() TO authenticated;

-- RPC: إضافة/تحديث مشرف
CREATE OR REPLACE FUNCTION public.admin_grant_staff(_email text, _role text, _paths text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _role NOT IN ('admin','moderator') THEN RAISE EXCEPTION 'invalid role'; END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email)=lower(_email);
  IF _uid IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  -- Remove existing admin/moderator role, then add requested
  DELETE FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','moderator');
  INSERT INTO public.user_roles(user_id, role) VALUES(_uid, _role::app_role) ON CONFLICT DO NOTHING;
  INSERT INTO public.admin_staff_perms(user_id, allowed_paths, updated_by)
    VALUES(_uid, _paths, auth.uid())
    ON CONFLICT(user_id) DO UPDATE SET allowed_paths=EXCLUDED.allowed_paths, updated_at=now(), updated_by=auth.uid();
  RETURN _uid;
END;$$;
GRANT EXECUTE ON FUNCTION public.admin_grant_staff(text,text,text[]) TO authenticated;

-- RPC: تحديث الصلاحيات فقط
CREATE OR REPLACE FUNCTION public.admin_set_staff_paths(_uid uuid, _paths text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_super_admin(_uid) THEN RAISE EXCEPTION 'cannot modify super admin'; END IF;
  INSERT INTO public.admin_staff_perms(user_id, allowed_paths, updated_by)
    VALUES(_uid, _paths, auth.uid())
    ON CONFLICT(user_id) DO UPDATE SET allowed_paths=EXCLUDED.allowed_paths, updated_at=now(), updated_by=auth.uid();
END;$$;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_paths(uuid,text[]) TO authenticated;

-- RPC: تغيير نوع الدور
CREATE OR REPLACE FUNCTION public.admin_set_staff_role(_uid uuid, _role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_super_admin(_uid) THEN RAISE EXCEPTION 'cannot modify super admin'; END IF;
  IF _role NOT IN ('admin','moderator') THEN RAISE EXCEPTION 'invalid role'; END IF;
  DELETE FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','moderator');
  INSERT INTO public.user_roles(user_id, role) VALUES(_uid, _role::app_role);
END;$$;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_role(uuid,text) TO authenticated;

-- RPC: إزالة مشرف كليًا
CREATE OR REPLACE FUNCTION public.admin_revoke_staff(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_super_admin(_uid) THEN RAISE EXCEPTION 'cannot revoke super admin'; END IF;
  DELETE FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','moderator');
  DELETE FROM public.admin_staff_perms WHERE user_id=_uid;
END;$$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_staff(uuid) TO authenticated;

-- Backfill: the previously hardcoded limited moderator
INSERT INTO public.admin_staff_perms(user_id, allowed_paths)
VALUES ('ce5a35be-41fc-4d66-b47c-ac9ace216b8b',
  ARRAY['/admin/tickets','/admin/codes','/admin/players','/admin/sanctions'])
ON CONFLICT(user_id) DO NOTHING;
