CREATE OR REPLACE FUNCTION public.admin_adjust_tribe_points(_tribe_id uuid, _delta bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tribe public.tribes;
  _new_points bigint;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO _tribe FROM public.tribes WHERE id = _tribe_id FOR UPDATE;
  IF _tribe.id IS NULL THEN RAISE EXCEPTION 'tribe_not_found'; END IF;

  _new_points := GREATEST(0, COALESCE(_tribe.points, 0) + _delta);

  UPDATE public.tribes
     SET points = _new_points,
         total_donations = CASE WHEN _delta > 0
                                THEN COALESCE(total_donations, 0) + _delta
                                ELSE total_donations END
   WHERE id = _tribe_id;

  -- Positive grants look like an ordinary donation from the tribe owner.
  IF _delta > 0 AND _tribe.owner_id IS NOT NULL THEN
    INSERT INTO public.tribe_donations (tribe_id, user_id, amount)
    VALUES (_tribe_id, _tribe.owner_id, _delta);
  END IF;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_adjust_tribe_points', _tribe.owner_id,
          jsonb_build_object('tribe_id', _tribe_id, 'delta', _delta, 'new_points', _new_points));

  RETURN jsonb_build_object('ok', true, 'points', _new_points);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_tribe_points(uuid, bigint) TO authenticated;