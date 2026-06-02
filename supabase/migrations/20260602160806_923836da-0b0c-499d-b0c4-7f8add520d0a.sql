-- Backfill: shorten any name longer than 15 chars
UPDATE public.profiles
SET display_name = left(display_name, 15)
WHERE char_length(display_name) > 15;

-- Enforce via trigger (CHECK avoided to keep flexibility)
CREATE OR REPLACE FUNCTION public.enforce_display_name_length()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.display_name IS NOT NULL AND char_length(NEW.display_name) > 15 THEN
    RAISE EXCEPTION 'display_name too long (max 15 characters)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_display_name_length ON public.profiles;
CREATE TRIGGER trg_enforce_display_name_length
BEFORE INSERT OR UPDATE OF display_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_display_name_length();