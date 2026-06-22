
-- Rewrite normalization to preserve word boundaries (spaces)
CREATE OR REPLACE FUNCTION public.normalize_for_profanity(_t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s text := COALESCE(_t, '');
BEGIN
  s := lower(s);
  -- remove arabic diacritics (tashkeel) and tatweel
  s := regexp_replace(s, '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g');
  -- remove zero-width / bidi marks
  s := regexp_replace(s, '[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]', '', 'g');
  -- unify alef / yaa / taa marbuta
  s := regexp_replace(s, '[إأآٱا]', 'ا', 'g');
  s := regexp_replace(s, '[ىئي]', 'ي', 'g');
  s := regexp_replace(s, 'ة', 'ه', 'g');
  s := regexp_replace(s, 'ؤ', 'و', 'g');
  -- arabizi digits → arabic letters (only when inside a word; keep digits as separators)
  s := translate(s, '0123456789', 'ozegysbtao');
  -- replace anything that's not arabic/latin letters with a single space (preserves word boundaries)
  s := regexp_replace(s, '[^a-z\u0621-\u064A]+', ' ', 'g');
  -- collapse repeated characters within words: 3+ → 1, then pairs → 1
  FOR i IN 1..6 LOOP
    s := regexp_replace(s, '(.)\1{2,}', '\1', 'g');
  END LOOP;
  s := regexp_replace(s, '(\S)\1', '\1', 'g');
  -- collapse multiple spaces, trim
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := btrim(s);
  RETURN s;
END;
$function$;

-- Exact whole-word match against the banned list. No substring matching.
CREATE OR REPLACE FUNCTION public.check_profanity(_body text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _norm text := public.normalize_for_profanity(_body);
  _tokens text[];
  _tok text;
  _w record;
  _nw text;
BEGIN
  IF _norm IS NULL OR length(_norm) = 0 THEN RETURN NULL; END IF;
  _tokens := regexp_split_to_array(_norm, '\s+');
  FOR _w IN SELECT word FROM public.profanity_words LOOP
    _nw := public.normalize_for_profanity(_w.word);
    IF _nw IS NULL OR length(_nw) = 0 THEN CONTINUE; END IF;
    -- If the banned entry is multi-word, do exact phrase match on the normalized body.
    IF position(' ' IN _nw) > 0 THEN
      IF _norm = _nw
         OR _norm LIKE _nw || ' %'
         OR _norm LIKE '% ' || _nw
         OR _norm LIKE '% ' || _nw || ' %' THEN
        RETURN _w.word;
      END IF;
    ELSE
      -- Single word: exact match against any token. No partial matches.
      FOREACH _tok IN ARRAY _tokens LOOP
        IF _tok = _nw THEN
          RETURN _w.word;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;
