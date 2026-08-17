ALTER TABLE public.tribes ADD COLUMN IF NOT EXISTS founder_id uuid;

UPDATE public.tribes t
SET founder_id = COALESCE(
  (SELECT tm.user_id FROM public.tribe_members tm WHERE tm.tribe_id = t.id ORDER BY tm.joined_at ASC NULLS LAST LIMIT 1),
  t.owner_id
)
WHERE t.founder_id IS NULL;

CREATE OR REPLACE FUNCTION public._stamp_tribe_founder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.founder_id IS NULL THEN
    NEW.founder_id := NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_tribe_founder ON public.tribes;
CREATE TRIGGER trg_stamp_tribe_founder
BEFORE INSERT ON public.tribes
FOR EACH ROW EXECUTE FUNCTION public._stamp_tribe_founder();

-- Members list for admin panel
CREATE OR REPLACE FUNCTION public.admin_tribe_members(_tribe_id uuid)
RETURNS TABLE(user_id uuid, role text, joined_at timestamptz, donation_coins bigint,
              display_name text, username text, avatar_emoji text, level integer, is_founder boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT tm.user_id, tm.role, tm.joined_at, COALESCE(tm.donation_coins,0),
         p.display_name, p.username, p.avatar_emoji, p.level,
         (t.founder_id = tm.user_id)
  FROM public.tribe_members tm
  JOIN public.tribes t ON t.id = tm.tribe_id
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.tribe_id = _tribe_id
  ORDER BY (tm.role = 'owner') DESC, COALESCE(tm.donation_coins,0) DESC;
END;
$$;

-- Set a new tribe leader
CREATE OR REPLACE FUNCTION public.admin_set_tribe_owner(_tribe_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_member');
  END IF;

  UPDATE public.tribe_members SET role = 'member'
   WHERE tribe_id = _tribe_id AND role = 'owner' AND user_id <> _user_id;
  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = _tribe_id AND user_id = _user_id;
  UPDATE public.tribes SET owner_id = _user_id WHERE id = _tribe_id;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'tribe_set_owner', _user_id, jsonb_build_object('tribe_id', _tribe_id));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Kick a member out of a tribe
CREATE OR REPLACE FUNCTION public.admin_kick_tribe_member(_tribe_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _user_id;
  UPDATE public.profiles SET tribe_id = NULL WHERE id = _user_id AND tribe_id = _tribe_id;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'tribe_kick_member', _user_id, jsonb_build_object('tribe_id', _tribe_id));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tribe_members(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_set_tribe_owner(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_kick_tribe_member(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_tribe_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tribe_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_kick_tribe_member(uuid, uuid) TO authenticated;