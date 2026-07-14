
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_name_change_available boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.trg_enforce_display_name_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last timestamptz;
  v_next timestamptz;
  v_is_service boolean;
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    -- Admin / service_role bypass: no cooldown, no consumption of free change
    v_is_service := current_user IN ('service_role','postgres','supabase_admin')
                 OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';

    IF v_is_service THEN
      NEW.display_name_changed_at := now();
      RETURN NEW;
    END IF;

    -- Free change available? consume it and skip cooldown
    IF coalesce(OLD.free_name_change_available, true) THEN
      NEW.free_name_change_available := false;
      NEW.display_name_changed_at := now();
      RETURN NEW;
    END IF;

    v_last := OLD.display_name_changed_at;
    IF v_last IS NOT NULL AND v_last > now() - interval '14 days' THEN
      v_next := v_last + interval '14 days';
      RAISE EXCEPTION 'display_name_cooldown: يمكنك تغيير الاسم مرة كل 14 يوم. المتاح بعد: %', to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
    END IF;
    NEW.display_name_changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
