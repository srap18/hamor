CREATE OR REPLACE FUNCTION public.block_profanity_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_body text;
  v_hit text;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN
    v_body := NEW.body;
  ELSIF TG_TABLE_NAME = 'destroyer_messages' THEN
    v_body := NEW.message;
  ELSE
    RETURN NEW;
  END IF;

  IF v_body IS NULL OR length(btrim(v_body)) = 0 THEN
    RETURN NEW;
  END IF;

  v_hit := public.check_profanity(v_body);
  IF v_hit IS NOT NULL THEN
    RAISE EXCEPTION 'profanity_blocked: %', v_hit
      USING HINT = 'الرسالة تحتوي على كلمة غير مسموح بها';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_profanity_messages ON public.messages;
CREATE TRIGGER trg_block_profanity_messages
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.block_profanity_messages();

DROP TRIGGER IF EXISTS trg_block_profanity_destroyer ON public.destroyer_messages;
CREATE TRIGGER trg_block_profanity_destroyer
BEFORE INSERT ON public.destroyer_messages
FOR EACH ROW EXECUTE FUNCTION public.block_profanity_messages();

DELETE FROM public.destroyer_messages
 WHERE id = 'd1e85ae3-7ec1-4c05-bd70-02e2d8301609';

ALTER TABLE public.chat_mutes DISABLE TRIGGER trg_guard_chat_mutes_insert, DISABLE TRIGGER prevent_mute_admin_trg;
INSERT INTO public.chat_mutes (user_id, reason, expires_at, active)
VALUES ('08a0cffb-c6bc-42ec-adc1-26c2e82fa9a6',
        'إهانة لاعب آخر في رسالة الهجوم (كلمة مسيئة)',
        now() + interval '24 hours',
        true);
ALTER TABLE public.chat_mutes ENABLE TRIGGER trg_guard_chat_mutes_insert, ENABLE TRIGGER prevent_mute_admin_trg;