CREATE OR REPLACE FUNCTION public.guard_admin_only_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Internal, transaction-scoped authorization used only by trusted
  -- SECURITY DEFINER functions whose EXECUTE privilege is not public.
  IF current_setting('app.allow_auto_sanction', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'chat_mutes' THEN
    -- Allow profanity self-mutes.
    IF NEW.user_id = auth.uid()
       AND NEW.muted_by = auth.uid()
       AND NEW.reason LIKE 'profanity:%' THEN
      RETURN NEW;
    END IF;
    -- Allow chat moderators (RLS policy enforces the duration cap).
    IF public.is_chat_mod(auth.uid()) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.flag_cheat(
  _user uuid,
  _kind text,
  _severity integer,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _total int;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;

  INSERT INTO public.cheat_flags(user_id, kind, severity, details)
  VALUES (_user, _kind, GREATEST(_severity, 1), COALESCE(_details, '{}'::jsonb));

  SELECT COALESCE(SUM(severity), 0) INTO _total
  FROM public.cheat_flags
  WHERE user_id = _user AND resolved = false;

  PERFORM set_config('app.allow_auto_sanction', 'true', true);
  BEGIN
    IF _total >= 10 THEN
      INSERT INTO public.bans(user_id, reason, active, expires_at, banned_by)
      VALUES (_user, 'auto: cheat score >= 10 (24h)', true, now() + interval '24 hours', NULL)
      ON CONFLICT DO NOTHING;
    ELSIF _total >= 5 THEN
      INSERT INTO public.chat_mutes(user_id, reason, expires_at, active)
      VALUES (_user, 'auto: cheat score >= 5', now() + interval '48 hours', true)
      ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.allow_auto_sanction', 'false', true);
    RAISE;
  END;
  PERFORM set_config('app.allow_auto_sanction', 'false', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_sanctions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('app.allow_auto_sanction', 'true', true);
  BEGIN
    UPDATE public.bans
       SET active = false
     WHERE active = true
       AND expires_at IS NOT NULL
       AND expires_at <= now();

    UPDATE public.chat_mutes
       SET active = false
     WHERE active = true
       AND expires_at IS NOT NULL
       AND expires_at <= now();
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.allow_auto_sanction', 'false', true);
    RAISE;
  END;
  PERFORM set_config('app.allow_auto_sanction', 'false', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.flag_cheat(uuid,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_cheat(uuid,text,integer,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.cleanup_expired_sanctions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sanctions() TO service_role;