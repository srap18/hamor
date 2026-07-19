CREATE OR REPLACE FUNCTION public.admin_adjust_weekly_xp(_user_id uuid, _delta bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _new bigint;
BEGIN
  IF _caller IS NULL OR NOT public.has_role(_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles
     SET weekly_xp = GREATEST(0, COALESCE(weekly_xp,0) + _delta)
   WHERE id = _user_id
   RETURNING weekly_xp INTO _new;
  IF _new IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_weekly_xp(uuid, bigint) TO authenticated;