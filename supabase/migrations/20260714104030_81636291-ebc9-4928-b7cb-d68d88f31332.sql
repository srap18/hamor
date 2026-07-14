
CREATE OR REPLACE FUNCTION public.assert_email_verified()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $fn$
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
  IF v_level > 10 THEN RETURN; END IF;
  RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501';
END; $fn$;

CREATE OR REPLACE FUNCTION public.trg_messages_require_email_verified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.sender_id = auth.uid() THEN
    PERFORM public.assert_email_verified();
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS messages_require_email_verified ON public.messages;
CREATE TRIGGER messages_require_email_verified
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.trg_messages_require_email_verified();
