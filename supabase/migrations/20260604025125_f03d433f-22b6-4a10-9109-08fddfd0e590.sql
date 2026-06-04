CREATE OR REPLACE FUNCTION public._validate_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.username := lower(trim(NEW.username));
  IF NEW.username !~ '^[a-z0-9_]{1,20}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME';
  END IF;
  RETURN NEW;
END; $function$;