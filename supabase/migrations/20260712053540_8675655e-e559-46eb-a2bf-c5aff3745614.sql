
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name_changed_at timestamptz;

GRANT SELECT (display_name_changed_at) ON public.profiles TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.trg_enforce_display_name_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
  v_next timestamptz;
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    v_last := OLD.display_name_changed_at;
    IF v_last IS NOT NULL AND v_last > now() - interval '14 days' THEN
      v_next := v_last + interval '14 days';
      RAISE EXCEPTION 'display_name_cooldown: يمكنك تغيير الاسم مرة كل 14 يوم. المتاح بعد: %', to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
    END IF;
    NEW.display_name_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_display_name_cooldown ON public.profiles;
CREATE TRIGGER trg_enforce_display_name_cooldown
BEFORE UPDATE OF display_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_display_name_cooldown();
