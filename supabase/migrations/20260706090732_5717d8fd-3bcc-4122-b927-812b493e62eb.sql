
-- Fix existing orphaned-owner tribes: promote oldest member to owner
DO $$
DECLARE r record; new_owner uuid;
BEGIN
  FOR r IN
    SELECT t.id FROM public.tribes t
    WHERE NOT EXISTS (SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = t.id AND m.user_id = t.owner_id)
  LOOP
    SELECT user_id INTO new_owner FROM public.tribe_members
      WHERE tribe_id = r.id ORDER BY joined_at ASC LIMIT 1;
    IF new_owner IS NOT NULL THEN
      UPDATE public.tribes SET owner_id = new_owner WHERE id = r.id;
      UPDATE public.tribe_members SET role = 'leader' WHERE tribe_id = r.id AND user_id = new_owner;
    ELSE
      DELETE FROM public.tribes WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.leave_tribe(_tribe_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _new_owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT owner_id INTO _owner FROM public.tribes WHERE id = _tribe_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'tribe not found'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'not a member';
  END IF;

  IF _owner = _uid THEN
    SELECT user_id INTO _new_owner FROM public.tribe_members
      WHERE tribe_id = _tribe_id AND user_id <> _uid
      ORDER BY (role = 'officer') DESC, joined_at ASC
      LIMIT 1;

    IF _new_owner IS NOT NULL THEN
      UPDATE public.tribes SET owner_id = _new_owner WHERE id = _tribe_id;
      UPDATE public.tribe_members SET role = 'leader' WHERE tribe_id = _tribe_id AND user_id = _new_owner;
      DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid;
      UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
      RETURN json_build_object('ok', true, 'transferred_to', _new_owner);
    ELSE
      -- last member (owner alone) leaves → delete the tribe
      DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id;
      DELETE FROM public.tribes WHERE id = _tribe_id;
      UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
      RETURN json_build_object('ok', true, 'deleted', true);
    END IF;
  ELSE
    DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid;
    UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
    RETURN json_build_object('ok', true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_tribe(uuid) TO authenticated;
