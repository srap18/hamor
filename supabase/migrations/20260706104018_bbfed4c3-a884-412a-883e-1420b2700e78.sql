
CREATE OR REPLACE FUNCTION public.leave_tribe(_tribe_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _new_owner uuid;
  _is_member boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT owner_id INTO _owner FROM public.tribes WHERE id = _tribe_id FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE tribe_id = _tribe_id AND user_id = _uid
  ) INTO _is_member;

  -- Self-heal: profile points to a tribe the user isn't actually in,
  -- or the tribe no longer exists. Clear profile.tribe_id and return ok.
  IF _owner IS NULL OR NOT _is_member THEN
    UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
    RETURN json_build_object('ok', true, 'healed', true);
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
$function$;

-- One-time cleanup: clear tribe_id on profiles that have no matching tribe_members row.
UPDATE public.profiles p
   SET tribe_id = NULL
 WHERE p.tribe_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tribe_members tm
      WHERE tm.user_id = p.id AND tm.tribe_id = p.tribe_id
   );
