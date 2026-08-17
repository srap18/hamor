-- 1) demote extra owners: keep only the row matching tribes.owner_id
UPDATE public.tribe_members tm
SET role = 'moderator'
FROM public.tribes t
WHERE t.id = tm.tribe_id
  AND tm.role = 'owner'
  AND tm.user_id IS DISTINCT FROM t.owner_id;

-- if the official owner has no membership row marked owner, fix it
UPDATE public.tribe_members tm
SET role = 'owner'
FROM public.tribes t
WHERE t.id = tm.tribe_id
  AND tm.user_id = t.owner_id
  AND tm.role <> 'owner';

-- 2) prevent recurrence
CREATE UNIQUE INDEX IF NOT EXISTS tribe_members_one_owner_idx
  ON public.tribe_members (tribe_id)
  WHERE role = 'owner';

-- 3) set_owner demotes ALL current owners first
CREATE OR REPLACE FUNCTION public.admin_tribe_set_owner(_tribe_id uuid, _user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator')) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribes WHERE id = _tribe_id) THEN
    RAISE EXCEPTION 'tribe_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id=_tribe_id AND user_id=_user_id) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  UPDATE public.tribe_members SET role = 'member'
   WHERE tribe_id = _tribe_id AND role = 'owner' AND user_id <> _user_id;
  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = _tribe_id AND user_id = _user_id;
  UPDATE public.tribes SET owner_id = _user_id WHERE id = _tribe_id;
END;
$function$;