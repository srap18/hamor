
CREATE OR REPLACE FUNCTION public.send_chat_message_safe(
  _channel text, _body text,
  _recipient_id uuid DEFAULT NULL,
  _tribe_id uuid DEFAULT NULL,
  _reply_to_id uuid DEFAULT NULL,
  _reply_to_body text DEFAULT NULL,
  _reply_to_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg_id uuid;
  _body text := btrim(COALESCE(_body, ''));
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body) = 0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body) > 500 THEN _body := left(_body, 500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  INSERT INTO public.messages(channel, sender_id, recipient_id, tribe_id, body, reply_to_id, reply_to_body, reply_to_name)
  VALUES (_channel, _uid, _recipient_id, _tribe_id, _body, _reply_to_id, _reply_to_body, _reply_to_name)
  RETURNING id INTO _msg_id;

  RETURN jsonb_build_object('status','sent','id',_msg_id);
END;
$$;

ALTER TABLE public.chat_mutes DISABLE TRIGGER trg_guard_chat_mutes_insert;
UPDATE public.chat_mutes SET active = false WHERE active = true;
ALTER TABLE public.chat_mutes ENABLE TRIGGER trg_guard_chat_mutes_insert;
