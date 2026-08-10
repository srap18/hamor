CREATE OR REPLACE FUNCTION public.prevent_lower_elite_vip_extension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  paid_level int;
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.elite_vip_level, 0) > COALESCE(NEW.elite_vip_level, 0)
     AND OLD.elite_vip_expires_at IS NOT NULL
     AND OLD.elite_vip_expires_at > now() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.elite_vip_level, 0) = COALESCE(OLD.elite_vip_level, 0)
     AND NEW.elite_vip_expires_at IS DISTINCT FROM OLD.elite_vip_expires_at
     AND NEW.elite_vip_expires_at > COALESCE(OLD.elite_vip_expires_at, '-infinity'::timestamptz)
     AND COALESCE(OLD.elite_vip_level, 0) > 0
     AND OLD.elite_vip_expires_at > now() THEN
    SELECT MAX((regexp_match(pp.pack_id, '^elite_vip_([1-6])_monthly$'))[1]::int)
      INTO paid_level
    FROM public.paddle_purchases pp
    WHERE pp.user_id = NEW.id
      AND pp.granted = true
      AND pp.created_at > now() - interval '10 minutes'
      AND pp.pack_id ~ '^elite_vip_[1-6]_monthly$';

    IF paid_level IS NOT NULL AND paid_level < OLD.elite_vip_level THEN
      NEW.elite_vip_expires_at := OLD.elite_vip_expires_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_lower_elite_vip_extension ON public.profiles;
CREATE TRIGGER trg_prevent_lower_elite_vip_extension
BEFORE UPDATE OF elite_vip_level, elite_vip_expires_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_lower_elite_vip_extension();

REVOKE ALL ON FUNCTION public.prevent_lower_elite_vip_extension() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_lower_elite_vip_extension() TO service_role;