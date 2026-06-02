CREATE OR REPLACE FUNCTION public.admin_grant_code_to_online(_code text, _within_minutes integer)
RETURNS TABLE(targeted integer, granted integer, failed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cutoff timestamptz;
  _u record;
  _ok integer := 0;
  _fail integer := 0;
  _tot integer := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RAISE EXCEPTION 'code required';
  END IF;
  IF _within_minutes IS NULL OR _within_minutes < 0 THEN
    _within_minutes := 0;
  END IF;

  _cutoff := now() - make_interval(mins => _within_minutes);

  FOR _u IN
    SELECT id FROM public.profiles
    WHERE online_at IS NOT NULL AND online_at >= _cutoff
  LOOP
    _tot := _tot + 1;
    BEGIN
      PERFORM public.admin_redeem_code_for(_code, _u.id);
      _ok := _ok + 1;
    EXCEPTION WHEN OTHERS THEN
      _fail := _fail + 1;
    END;
  END LOOP;

  INSERT INTO public.admin_audit(admin_id, action, details)
  VALUES (_uid, 'grant_code_to_online',
          jsonb_build_object('code', _code, 'within_minutes', _within_minutes,
                             'targeted', _tot, 'granted', _ok, 'failed', _fail));

  targeted := _tot;
  granted := _ok;
  failed := _fail;
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_grant_code_to_online(text, integer) TO authenticated;

-- Helper to count online users within a window (for UI preview)
CREATE OR REPLACE FUNCTION public.admin_count_online(_within_minutes integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cnt integer := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _within_minutes IS NULL OR _within_minutes < 0 THEN _within_minutes := 0; END IF;
  SELECT COUNT(*)::int INTO _cnt
  FROM public.profiles
  WHERE online_at IS NOT NULL
    AND online_at >= now() - make_interval(mins => _within_minutes);
  RETURN _cnt;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_count_online(integer) TO authenticated;