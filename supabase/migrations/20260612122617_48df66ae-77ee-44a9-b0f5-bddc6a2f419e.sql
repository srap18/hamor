
CREATE OR REPLACE FUNCTION public.guard_notifications_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.allow_notif', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_target_burned_bg(_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _gems integer;
  _burned_until timestamptz;
  _repairer_name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL THEN RAISE EXCEPTION 'target required'; END IF;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _uid;
  IF _gems IS NULL OR _gems < 100 THEN RAISE EXCEPTION 'not enough gems'; END IF;

  SELECT bg_burned_until INTO _burned_until FROM public.profiles WHERE id = _target_id;
  IF _burned_until IS NULL OR _burned_until <= now() THEN
    RAISE EXCEPTION 'not burned';
  END IF;

  UPDATE public.profiles SET gems = gems - 100 WHERE id = _uid;
  UPDATE public.profiles SET bg_burned_until = NULL WHERE id = _target_id;

  SELECT COALESCE(display_name, username, 'لاعب') INTO _repairer_name
  FROM public.profiles WHERE id = _uid;

  PERFORM set_config('app.allow_notif', 'true', true);
  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  VALUES (
    _target_id,
    'تم إصلاح خلفيتك 🛠️',
    _repairer_name || ' أصلح خلفيتك المحترقة!',
    'support',
    _uid,
    jsonb_build_object('action', 'bg_repair')
  );
  PERFORM set_config('app.allow_notif', 'false', true);
END;
$function$;
