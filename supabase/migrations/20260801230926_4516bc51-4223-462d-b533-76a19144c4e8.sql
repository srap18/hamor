CREATE OR REPLACE FUNCTION public.trg_enforce_display_name_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_last timestamptz;
  v_next timestamptz;
  v_privileged boolean;
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    -- NOTE: do NOT use current_user here. This function is SECURITY DEFINER,
    -- so current_user is always the owner (postgres) and every change would
    -- be treated as a service bypass.
    v_uid := auth.uid();
    v_privileged :=
      v_uid IS NULL                                            -- service role / direct SQL
      OR coalesce(current_setting('app.server_write', true), '') = 'on'
      OR public.is_admin(v_uid);

    IF v_privileged THEN
      NEW.display_name_changed_at := now();
      RETURN NEW;
    END IF;

    -- Owner-only from a normal session.
    IF v_uid IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'forbidden: display_name owner only';
    END IF;

    -- One free change, then a strict 14-day server-clock cooldown.
    IF coalesce(OLD.free_name_change_available, true) THEN
      NEW.free_name_change_available := false;
      NEW.display_name_changed_at := now();
      RETURN NEW;
    END IF;

    v_last := OLD.display_name_changed_at;
    IF v_last IS NOT NULL AND v_last > now() - interval '14 days' THEN
      v_next := v_last + interval '14 days';
      RAISE EXCEPTION 'display_name_cooldown: يمكنك تغيير الاسم مرة كل 14 يوم. المتاح بعد: %',
        to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
    END IF;

    NEW.display_name_changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;