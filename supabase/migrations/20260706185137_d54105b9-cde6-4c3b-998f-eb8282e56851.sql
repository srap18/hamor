
-- 1) Promote a new owner for a tribe (used both by backfill and by the
--    auto-transfer trigger). Prefers a moderator, then oldest member,
--    highest donations as tiebreaker.
CREATE OR REPLACE FUNCTION public.promote_next_owner(_tribe_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_owner uuid;
BEGIN
  SELECT user_id INTO _new_owner
  FROM public.tribe_members
  WHERE tribe_id = _tribe_id
    AND role <> 'owner'
  ORDER BY (role = 'moderator') DESC, joined_at ASC, donation_coins DESC
  LIMIT 1;

  IF _new_owner IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.tribe_members
     SET role = 'owner'
   WHERE tribe_id = _tribe_id AND user_id = _new_owner;

  UPDATE public.tribes
     SET owner_id = _new_owner
   WHERE id = _tribe_id;

  RETURN _new_owner;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_next_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_next_owner(uuid) TO service_role;

-- 2) Auto-transfer on owner leave: if the removed row was the owner and
--    the tribe still has members, promote a new owner BEFORE the row is
--    deleted so the tribes.owner_id FK stays valid.
CREATE OR REPLACE FUNCTION public.auto_transfer_owner_on_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_owner uuid;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE tribe_id = OLD.tribe_id AND user_id <> OLD.user_id
  ) THEN
    RETURN OLD; -- last member; delete_tribe_if_empty will remove the tribe
  END IF;

  SELECT user_id INTO _new_owner
  FROM public.tribe_members
  WHERE tribe_id = OLD.tribe_id AND user_id <> OLD.user_id
  ORDER BY (role = 'moderator') DESC, joined_at ASC, donation_coins DESC
  LIMIT 1;

  UPDATE public.tribe_members
     SET role = 'owner'
   WHERE tribe_id = OLD.tribe_id AND user_id = _new_owner;

  UPDATE public.tribes
     SET owner_id = _new_owner
   WHERE id = OLD.tribe_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_transfer_owner_on_leave ON public.tribe_members;
CREATE TRIGGER trg_auto_transfer_owner_on_leave
BEFORE DELETE ON public.tribe_members
FOR EACH ROW
EXECUTE FUNCTION public.auto_transfer_owner_on_leave();

-- 3) Public RPC to transfer leadership to another member. Only the current
--    owner may call it. Target must be an existing member of the same tribe.
CREATE OR REPLACE FUNCTION public.transfer_tribe_ownership(_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _tribe uuid;
BEGIN
  IF _me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'auth_required');
  END IF;
  IF _target IS NULL OR _target = _me THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_target');
  END IF;

  SELECT tribe_id INTO _tribe
  FROM public.tribe_members
  WHERE user_id = _me AND role = 'owner'
  LIMIT 1;

  IF _tribe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owner');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE tribe_id = _tribe AND user_id = _target
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'target_not_member');
  END IF;

  UPDATE public.tribe_members SET role = 'member'
   WHERE tribe_id = _tribe AND user_id = _me;
  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = _tribe AND user_id = _target;
  UPDATE public.tribes SET owner_id = _target WHERE id = _tribe;

  RETURN jsonb_build_object('ok', true, 'tribe_id', _tribe, 'new_owner', _target);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_tribe_ownership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_tribe_ownership(uuid) TO authenticated;

-- 4) Backfill: any existing tribe whose owner_id is not a current member
--    gets a fresh owner promoted from the remaining roster.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.id FROM public.tribes t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tribe_members m
      WHERE m.tribe_id = t.id AND m.user_id = t.owner_id
    )
  LOOP
    PERFORM public.promote_next_owner(r.id);
  END LOOP;
END $$;
