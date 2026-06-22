
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS elite_vip_login_broadcast_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.post_elite_vip_login_broadcast()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO _profile FROM public.profiles WHERE id = auth.uid();
  IF _profile.id IS NULL OR COALESCE(_profile.elite_vip_level, 0) < 3 THEN
    RETURN;
  END IF;

  -- User preference: skip broadcast if they disabled it
  IF COALESCE(_profile.elite_vip_login_broadcast_enabled, true) = false THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.elite_vip_login_broadcasts
    WHERE user_id = _profile.id AND created_at > now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.elite_vip_login_broadcasts
    (user_id, display_name, elite_vip_level, avatar_emoji, avatar_url)
  VALUES
    (_profile.id, _profile.display_name, _profile.elite_vip_level,
     _profile.avatar_emoji, _profile.avatar_url);

  PERFORM public.cleanup_elite_login_broadcasts();
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_elite_vip_login_broadcast(_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.profiles
    SET elite_vip_login_broadcast_enabled = COALESCE(_enabled, true)
    WHERE id = auth.uid();
  RETURN COALESCE(_enabled, true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_elite_vip_login_broadcast(boolean) TO authenticated;
