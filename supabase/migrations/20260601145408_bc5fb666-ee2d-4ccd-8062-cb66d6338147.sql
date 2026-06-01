CREATE OR REPLACE FUNCTION public.flag_cheat(_user uuid, _kind text, _severity int, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _total int;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;

  INSERT INTO public.cheat_flags(user_id, kind, severity, details)
  VALUES (_user, _kind, GREATEST(_severity,1), COALESCE(_details, '{}'::jsonb));

  SELECT COALESCE(SUM(severity),0) INTO _total
  FROM public.cheat_flags
  WHERE user_id = _user AND resolved = false;

  IF _total >= 10 THEN
    -- 24-hour temporary ban instead of permanent
    INSERT INTO public.bans(user_id, reason, active, expires_at, banned_by)
    VALUES (_user, 'auto: cheat score >= 10 (24h)', true, now() + interval '24 hours', NULL)
    ON CONFLICT DO NOTHING;
  ELSIF _total >= 5 THEN
    INSERT INTO public.chat_mutes(user_id, reason, expires_at, active)
    VALUES (_user, 'auto: cheat score >= 5', now() + interval '48 hours', true)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;