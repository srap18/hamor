CREATE OR REPLACE FUNCTION public.transfer_tribe_ownership(_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  PERFORM set_config('app.skip_owner_autofix', '1', true);

  UPDATE public.tribe_members SET role = 'member'
   WHERE tribe_id = _tribe AND role = 'owner';
  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = _tribe AND user_id = _target;
  UPDATE public.tribes SET owner_id = _target WHERE id = _tribe;

  PERFORM set_config('app.skip_owner_autofix', '0', true);

  RETURN jsonb_build_object('ok', true, 'tribe_id', _tribe, 'new_owner', _target);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_tribe_owner(_tribe_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_member');
  END IF;

  PERFORM set_config('app.skip_owner_autofix', '1', true);

  UPDATE public.tribe_members SET role = 'member'
   WHERE tribe_id = _tribe_id AND role = 'owner' AND user_id <> _user_id;
  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = _tribe_id AND user_id = _user_id;
  UPDATE public.tribes SET owner_id = _user_id WHERE id = _tribe_id;

  PERFORM set_config('app.skip_owner_autofix', '0', true);

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'tribe_set_owner', _user_id, jsonb_build_object('tribe_id', _tribe_id));

  RETURN jsonb_build_object('ok', true);
END;
$function$;