CREATE OR REPLACE FUNCTION public.admin_tribe_set_owner(_tribe_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _old uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator')) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  SELECT owner_id INTO _old FROM public.tribes WHERE id = _tribe_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'tribe_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id=_tribe_id AND user_id=_user_id) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  UPDATE public.tribes SET owner_id = _user_id WHERE id = _tribe_id;
  UPDATE public.tribe_members SET role = 'member' WHERE tribe_id=_tribe_id AND user_id=_old;
  UPDATE public.tribe_members SET role = 'owner' WHERE tribe_id=_tribe_id AND user_id=_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tribe_kick_member(_tribe_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator')) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tribes WHERE id=_tribe_id AND owner_id=_user_id) THEN
    RAISE EXCEPTION 'cannot_kick_owner';
  END IF;
  DELETE FROM public.tribe_members WHERE tribe_id=_tribe_id AND user_id=_user_id;
  UPDATE public.profiles SET tribe_id = NULL WHERE id=_user_id AND tribe_id=_tribe_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tribe_set_owner(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.admin_tribe_kick_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_tribe_set_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tribe_kick_member(uuid, uuid) TO authenticated;