CREATE OR REPLACE FUNCTION public.trg_rate_limit_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.sender_id = auth.uid() THEN
    BEGIN
      PERFORM public._enforce_rate_limit('chat_message', 1500);
    EXCEPTION WHEN sqlstate '54000' THEN
      RAISE EXCEPTION 'الرجاء الانتظار قليلاً قبل إرسال رسالة أخرى'
        USING ERRCODE = '54000';
    END;
  END IF;
  RETURN NEW;
END;
$function$;