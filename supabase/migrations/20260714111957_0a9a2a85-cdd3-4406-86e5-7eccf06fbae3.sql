CREATE OR REPLACE FUNCTION public.assert_email_verified()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_confirmed timestamptz;
  v_level     int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT email_confirmed_at INTO v_confirmed FROM auth.users WHERE id = auth.uid();
  IF v_confirmed IS NOT NULL THEN RETURN; END IF;
  SELECT COALESCE(level, 1) INTO v_level FROM public.user_market WHERE user_id = auth.uid();
  v_level := COALESCE(v_level, 1);
  -- Only accounts strictly below ship-market level 10 must verify email.
  -- Level 10 and above are exempt so support/nuke/steal work for established players.
  IF v_level >= 10 THEN RETURN; END IF;
  RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501';
END; $function$;