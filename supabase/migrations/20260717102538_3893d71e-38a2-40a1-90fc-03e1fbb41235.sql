CREATE OR REPLACE FUNCTION public.resync_my_elite_vip()
RETURNS TABLE(level int, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _pack text;
  _pack_created timestamptz;
  _pack_level int;
  _current_level int;
  _current_exp timestamptz;
  _new_exp timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RETURN QUERY SELECT 0, NULL::timestamptz;
    RETURN;
  END IF;

  -- Latest granted Elite VIP purchase within its 30-day validity window.
  SELECT pp.pack_id, pp.created_at
    INTO _pack, _pack_created
  FROM public.paddle_purchases pp
  WHERE pp.user_id = _uid
    AND pp.granted = true
    AND pp.pack_id ~ '^elite_vip_[1-5]_monthly$'
    AND pp.created_at > now() - interval '30 days'
  ORDER BY pp.created_at DESC
  LIMIT 1;

  IF _pack IS NOT NULL THEN
    _pack_level := substring(_pack from 'elite_vip_([1-5])_monthly')::int;
    _new_exp := _pack_created + interval '30 days';

    SELECT elite_vip_level, elite_vip_expires_at
      INTO _current_level, _current_exp
    FROM public.profiles WHERE id = _uid;

    -- Only heal if the profile is behind — never lower an existing higher tier / longer expiry.
    IF coalesce(_current_level,0) < _pack_level
       OR _current_exp IS NULL
       OR _current_exp < _new_exp THEN
      UPDATE public.profiles
         SET elite_vip_level = GREATEST(coalesce(elite_vip_level,0), _pack_level),
             elite_vip_expires_at = GREATEST(coalesce(elite_vip_expires_at, now()), _new_exp)
       WHERE id = _uid;
    END IF;
  END IF;

  RETURN QUERY
    SELECT public.get_elite_vip_level(_uid)::int,
           (SELECT elite_vip_expires_at FROM public.profiles WHERE id = _uid);
END;
$$;

REVOKE ALL ON FUNCTION public.resync_my_elite_vip() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resync_my_elite_vip() TO authenticated;