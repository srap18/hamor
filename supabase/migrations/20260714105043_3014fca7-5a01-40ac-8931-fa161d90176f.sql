CREATE OR REPLACE FUNCTION public.assert_email_verified()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_confirmed timestamptz;
  v_created   timestamptz;
  v_level     int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT email_confirmed_at, created_at INTO v_confirmed, v_created FROM auth.users WHERE id = auth.uid();
  IF v_confirmed IS NOT NULL THEN RETURN; END IF;
  -- Grandfather any account created before the rule shipped.
  IF v_created IS NULL OR v_created < TIMESTAMPTZ '2026-07-14 09:00:00+00' THEN RETURN; END IF;
  SELECT COALESCE(level, 1) INTO v_level FROM public.user_market WHERE user_id = auth.uid();
  v_level := COALESCE(v_level, 1);
  -- Only NEW accounts at or below ship-market level 10 must verify.
  IF v_level > 10 THEN RETURN; END IF;
  RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501';
END; $function$;