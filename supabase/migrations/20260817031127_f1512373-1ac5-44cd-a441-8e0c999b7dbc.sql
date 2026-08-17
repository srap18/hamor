
CREATE OR REPLACE FUNCTION public.destyle_latin(_t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  out_s text := '';
  ch text;
  cp int;
  upper_starts int[] := ARRAY[120744,120782,120834,120886,120938,120990,121042,121094,121146,121198,121250,121302,121354];
  lower_starts int[] := ARRAY[120770,120808,120860,120912,120964,121016,121068,121120,121172,121224,121276,121328,121380];
  st int;
  mapped boolean;
BEGIN
  IF _t IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..length(_t) LOOP
    ch := substr(_t, i, 1);
    cp := ascii(ch);
    mapped := false;
    -- mathematical alphanumeric symbols (1D400-1D6A3)
    IF cp BETWEEN 119808 AND 120831 THEN
      IF ((cp - 119808) % 52) < 26 THEN
        out_s := out_s || chr(97 + ((cp - 119808) % 52));
      ELSE
        out_s := out_s || chr(97 + ((cp - 119808) % 52) - 26);
      END IF;
      mapped := true;
    -- mathematical digits 1D7CE-1D7FF
    ELSIF cp BETWEEN 120782 AND 120831 THEN
      out_s := out_s || chr(48 + ((cp - 120782) % 10));
      mapped := true;
    -- fullwidth latin
    ELSIF cp BETWEEN 65313 AND 65338 THEN
      out_s := out_s || chr(97 + cp - 65313); mapped := true;
    ELSIF cp BETWEEN 65345 AND 65370 THEN
      out_s := out_s || chr(97 + cp - 65345); mapped := true;
    ELSIF cp BETWEEN 65296 AND 65305 THEN
      out_s := out_s || chr(48 + cp - 65296); mapped := true;
    -- circled latin
    ELSIF cp BETWEEN 9398 AND 9423 THEN
      out_s := out_s || chr(97 + cp - 9398); mapped := true;
    ELSIF cp BETWEEN 9424 AND 9449 THEN
      out_s := out_s || chr(97 + cp - 9424); mapped := true;
    -- squared / negative circled latin
    ELSIF cp BETWEEN 127280 AND 127305 THEN
      out_s := out_s || chr(97 + cp - 127280); mapped := true;
    ELSIF cp BETWEEN 127312 AND 127337 THEN
      out_s := out_s || chr(97 + cp - 127312); mapped := true;
    ELSIF cp BETWEEN 127344 AND 127369 THEN
      out_s := out_s || chr(97 + cp - 127344); mapped := true;
    -- small caps / misc latin lookalikes
    ELSIF cp BETWEEN 7424 AND 7467 THEN
      out_s := out_s || lower(chr(65 + ((cp - 7424) % 26))); mapped := true;
    END IF;
    IF NOT mapped THEN out_s := out_s || ch; END IF;
  END LOOP;
  RETURN out_s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_contact_text(_t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE s text := lower(public.destyle_latin(COALESCE(_t,'')));
BEGIN
  s := regexp_replace(s, '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g');
  s := regexp_replace(s, '[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]', '', 'g');
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(s, '[إأآٱا]', 'ا', 'g');
  s := regexp_replace(s, '[ىئي]', 'ي', 'g');
  s := regexp_replace(s, 'ة', 'ه', 'g');
  s := regexp_replace(s, 'ؤ', 'و', 'g');
  s := regexp_replace(s, 'ﮐ|ﻙ|گ|ک', 'ك', 'g');
  s := regexp_replace(s, 'ﭺ|چ', 'ج', 'g');
  s := regexp_replace(s, 'پ', 'ب', 'g');
  s := regexp_replace(s, 'ڤ|ﭪ', 'ف', 'g');
  s := translate(s, '0134578@$!|', 'oieastasil');
  s := regexp_replace(s, '[^a-z0-9\u0621-\u064A]+', ' ', 'g');
  s := regexp_replace(s, '(.)\1+', '\1', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  RETURN s;
END;
$function$;
