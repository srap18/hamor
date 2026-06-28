
-- Strengthen display_name validation: clean characters + uniqueness + religious/length check
CREATE OR REPLACE FUNCTION public.enforce_display_name_length()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF NEW.display_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Trim
  NEW.display_name := btrim(NEW.display_name);

  IF NEW.display_name = '' THEN
    RETURN NEW;
  END IF;

  IF char_length(NEW.display_name) > 15 THEN
    RAISE EXCEPTION 'display_name too long (max 15 characters)';
  END IF;

  IF char_length(NEW.display_name) < 2 THEN
    RAISE EXCEPTION 'display_name too short (min 2 characters)';
  END IF;

  -- Allow only: Arabic letters (0600-06FF), English letters, digits, space, underscore, hyphen
  IF NEW.display_name !~ '^[\u0600-\u06FFA-Za-z0-9 _-]+$' THEN
    RAISE EXCEPTION 'display_name_invalid_chars';
  END IF;

  -- Must contain at least one letter (Arabic or English) — not only digits/symbols
  IF NEW.display_name !~ '[\u0600-\u06FFA-Za-z]' THEN
    RAISE EXCEPTION 'display_name_must_have_letter';
  END IF;

  IF public.is_disallowed_religious_name(NEW.display_name) THEN
    RAISE EXCEPTION 'display_name_disallowed_religious';
  END IF;

  -- Uniqueness (case-insensitive, ignoring extra spaces)
  v_norm := lower(regexp_replace(NEW.display_name, '\s+', ' ', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id <> NEW.id
      AND lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'display_name_taken';
  END IF;

  RETURN NEW;
END;
$function$;

-- Update is_display_name_taken to use the same normalization
CREATE OR REPLACE FUNCTION public.is_display_name_taken(p_name text, p_except uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))
      AND (p_except IS NULL OR id <> p_except)
  );
$function$;

-- New helper: validate a name client-side via RPC (mirrors trigger checks)
CREATE OR REPLACE FUNCTION public.validate_display_name(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  n text;
BEGIN
  IF p_name IS NULL THEN RETURN 'empty'; END IF;
  n := btrim(p_name);
  IF n = '' THEN RETURN 'empty'; END IF;
  IF char_length(n) < 2 THEN RETURN 'too_short'; END IF;
  IF char_length(n) > 15 THEN RETURN 'too_long'; END IF;
  IF n !~ '^[\u0600-\u06FFA-Za-z0-9 _-]+$' THEN RETURN 'invalid_chars'; END IF;
  IF n !~ '[\u0600-\u06FFA-Za-z]' THEN RETURN 'must_have_letter'; END IF;
  IF public.is_disallowed_religious_name(n) THEN RETURN 'religious'; END IF;
  RETURN 'ok';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.validate_display_name(text) TO anon, authenticated;

-- New handle_new_user: do NOT set a display_name from email or fallback "قبطان".
-- Use a unique placeholder so user is prompted to pick a name from inside the app.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_meta_name text;
  v_placeholder text;
  v_tries int := 0;
BEGIN
  v_meta_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  IF v_meta_name = '' THEN
    -- Generate a unique placeholder; user will rename from inside
    LOOP
      v_placeholder := 'قبطان' || lpad((floor(random()*999999)::int)::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE lower(btrim(display_name)) = lower(v_placeholder)
      ) OR v_tries > 20;
      v_tries := v_tries + 1;
    END LOOP;
    v_meta_name := v_placeholder;
  END IF;

  INSERT INTO public.profiles (id, display_name, avatar_emoji)
  VALUES (
    new.id,
    v_meta_name,
    coalesce(new.raw_user_meta_data ->> 'avatar_emoji', '🧑‍✈️')
  );
  RETURN new;
END;
$function$;
