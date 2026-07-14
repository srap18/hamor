ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_reward_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_display_name(p_name text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE n text;
BEGIN
  IF p_name IS NULL THEN RETURN 'empty'; END IF;
  n := btrim(p_name);
  IF n = '' THEN RETURN 'empty'; END IF;
  IF char_length(n) < 2 THEN RETURN 'too_short'; END IF;
  IF char_length(n) > 15 THEN RETURN 'too_long'; END IF;
  IF n ~ '[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]' THEN RETURN 'invalid_chars'; END IF;
  IF n !~ '^[\u0621-\u063A\u0641-\u064A\u066E-\u06D3A-Za-z0-9 _-]+$' THEN RETURN 'invalid_chars'; END IF;
  IF n !~ '[\u0621-\u063A\u0641-\u064A\u066E-\u06D3A-Za-z]' THEN RETURN 'must_have_letter'; END IF;
  IF public.is_disallowed_religious_name(n) THEN RETURN 'religious'; END IF;
  RETURN 'ok';
END; $fn$;

CREATE OR REPLACE FUNCTION public.assert_email_verified()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $fn$
DECLARE v_confirmed timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT email_confirmed_at INTO v_confirmed FROM auth.users WHERE id = auth.uid();
  IF v_confirmed IS NULL THEN RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501'; END IF;
END; $fn$;
GRANT EXECUTE ON FUNCTION public.assert_email_verified() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.my_verification_status()
RETURNS TABLE(email_verified boolean, phone_verified boolean, phone_reward_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT (u.email_confirmed_at IS NOT NULL), (u.phone_confirmed_at IS NOT NULL), (p.phone_reward_claimed_at IS NOT NULL)
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = auth.uid();
END; $fn$;
GRANT EXECUTE ON FUNCTION public.my_verification_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_phone_verification_reward()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_phone_ok boolean; v_already timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT (phone_confirmed_at IS NOT NULL) INTO v_phone_ok FROM auth.users WHERE id = v_uid;
  IF NOT COALESCE(v_phone_ok, false) THEN RAISE EXCEPTION 'phone_not_verified'; END IF;
  SELECT phone_reward_claimed_at INTO v_already FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_already IS NOT NULL THEN RAISE EXCEPTION 'already_claimed'; END IF;
  UPDATE public.profiles
    SET gems = gems + 500, phone_reward_claimed_at = now(), phone_verified_at = COALESCE(phone_verified_at, now())
  WHERE id = v_uid;
  INSERT INTO public.economy_audit(user_id, gems_delta, source, reason, meta)
  VALUES (v_uid, 500, 'phone_reward', 'phone_verification_reward', jsonb_build_object('one_time', true));
  RETURN jsonb_build_object('ok', true, 'gems_awarded', 500);
END; $fn$;
GRANT EXECUTE ON FUNCTION public.claim_phone_verification_reward() TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_validate_display_name()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE v text;
BEGIN
  IF NEW.display_name IS DISTINCT FROM COALESCE(OLD.display_name, '') THEN
    v := public.validate_display_name(NEW.display_name);
    IF v <> 'ok' THEN RAISE EXCEPTION 'display_name_%', v USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN NEW;
END; $fn$;