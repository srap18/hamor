
-- Rate limiting on chat messages (1.5s between messages per user)
CREATE OR REPLACE FUNCTION public.trg_rate_limit_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- only limit real user posts; skip if no auth context (system inserts)
  IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() THEN
    BEGIN
      PERFORM public._enforce_rate_limit('chat_message', 1500);
    EXCEPTION WHEN sqlstate '54000' THEN
      RAISE EXCEPTION 'الرجاء الانتظار قليلاً قبل إرسال رسالة أخرى'
        USING ERRCODE = '54000';
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_messages ON public.messages;
CREATE TRIGGER trg_rate_limit_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_rate_limit_messages();

-- Rate limiting on tribe donations (500ms between clicks per user)
CREATE OR REPLACE FUNCTION public.trg_rate_limit_tribe_donations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() THEN
    BEGIN
      PERFORM public._enforce_rate_limit('tribe_donation', 500);
    EXCEPTION WHEN sqlstate '54000' THEN
      RAISE EXCEPTION 'الرجاء الانتظار لحظة قبل إعادة المحاولة'
        USING ERRCODE = '54000';
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_tribe_donations ON public.tribe_donations;
CREATE TRIGGER trg_rate_limit_tribe_donations
  BEFORE INSERT ON public.tribe_donations
  FOR EACH ROW EXECUTE FUNCTION public.trg_rate_limit_tribe_donations();
