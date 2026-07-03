
CREATE TABLE IF NOT EXISTS public.dm_threads (
  user_low uuid NOT NULL,
  user_high uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  requester_id uuid NOT NULL,
  first_message_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  last_request_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);

GRANT SELECT ON public.dm_threads TO authenticated;
GRANT ALL ON public.dm_threads TO service_role;

ALTER TABLE public.dm_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_threads_select_participant ON public.dm_threads;
CREATE POLICY dm_threads_select_participant ON public.dm_threads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_low OR auth.uid() = user_high);

CREATE INDEX IF NOT EXISTS idx_dm_threads_status ON public.dm_threads(status);
CREATE INDEX IF NOT EXISTS idx_dm_threads_requester ON public.dm_threads(requester_id);

CREATE OR REPLACE FUNCTION public.dm_accept_request(_other uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid(); _lo uuid; _hi uuid; _t record;
BEGIN
  IF _uid IS NULL OR _other IS NULL OR _uid = _other THEN RAISE EXCEPTION 'bad request'; END IF;
  _lo := LEAST(_uid,_other); _hi := GREATEST(_uid,_other);
  SELECT * INTO _t FROM public.dm_threads WHERE user_low=_lo AND user_high=_hi FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no request'; END IF;
  IF _t.status='accepted' THEN RETURN jsonb_build_object('status','already_accepted'); END IF;
  IF _t.requester_id=_uid THEN RAISE EXCEPTION 'cannot accept own request'; END IF;
  UPDATE public.dm_threads SET status='accepted', responded_at=now() WHERE user_low=_lo AND user_high=_hi;
  RETURN jsonb_build_object('status','accepted');
END $$;

CREATE OR REPLACE FUNCTION public.dm_reject_request(_other uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid(); _lo uuid; _hi uuid; _t record;
BEGIN
  IF _uid IS NULL OR _other IS NULL OR _uid = _other THEN RAISE EXCEPTION 'bad'; END IF;
  _lo := LEAST(_uid,_other); _hi := GREATEST(_uid,_other);
  SELECT * INTO _t FROM public.dm_threads WHERE user_low=_lo AND user_high=_hi FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no request'; END IF;
  IF _t.requester_id=_uid THEN RAISE EXCEPTION 'cannot reject own request'; END IF;
  UPDATE public.dm_threads SET status='rejected', responded_at=now() WHERE user_low=_lo AND user_high=_hi;
  DELETE FROM public.messages
   WHERE channel='dm' AND ((sender_id=_lo AND recipient_id=_hi) OR (sender_id=_hi AND recipient_id=_lo));
  RETURN jsonb_build_object('status','rejected');
END $$;

CREATE OR REPLACE FUNCTION public.dm_cancel_request(_other uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid(); _lo uuid; _hi uuid; _t record;
BEGIN
  IF _uid IS NULL OR _other IS NULL THEN RAISE EXCEPTION 'bad'; END IF;
  _lo := LEAST(_uid,_other); _hi := GREATEST(_uid,_other);
  SELECT * INTO _t FROM public.dm_threads WHERE user_low=_lo AND user_high=_hi FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF _t.status='pending' AND _t.requester_id=_uid THEN
    DELETE FROM public.dm_threads WHERE user_low=_lo AND user_high=_hi;
    DELETE FROM public.messages
     WHERE channel='dm' AND ((sender_id=_lo AND recipient_id=_hi) OR (sender_id=_hi AND recipient_id=_lo));
    RETURN jsonb_build_object('status','cancelled');
  END IF;
  RETURN jsonb_build_object('status','no_op');
END $$;

CREATE OR REPLACE FUNCTION public.dm_block(_other uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _other IS NULL OR _uid=_other THEN RAISE EXCEPTION 'bad'; END IF;
  INSERT INTO public.user_blocks(blocker_id, blocked_id) VALUES (_uid,_other) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('status','blocked');
END $$;

CREATE OR REPLACE FUNCTION public.dm_unblock(_other uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _other IS NULL THEN RAISE EXCEPTION 'bad'; END IF;
  DELETE FROM public.user_blocks WHERE blocker_id=_uid AND blocked_id=_other;
  RETURN jsonb_build_object('status','unblocked');
END $$;

GRANT EXECUTE ON FUNCTION public.dm_accept_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_reject_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_cancel_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_block(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_unblock(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_chat_message_safe(
  _channel text, _body text,
  _recipient_id uuid DEFAULT NULL, _tribe_id uuid DEFAULT NULL,
  _reply_to_id uuid DEFAULT NULL, _reply_to_body text DEFAULT NULL, _reply_to_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg_id uuid;
  _body2 text := btrim(COALESCE(_body,''));
  _mute_reason text; _mute_expires timestamptz;
  _mlevel int;
  _lo uuid; _hi uuid; _thread record;
  _is_priv boolean;
  _cooldown interval := interval '24 hours';
  _status text := 'sent';
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body2)=0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body2)>500 THEN _body2 := left(_body2,500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  _is_priv := public.has_role(_uid,'admin') OR public.has_role(_uid,'moderator');

  IF NOT _is_priv THEN
    SELECT COALESCE(level,1) INTO _mlevel FROM public.user_market WHERE user_id=_uid;
    IF COALESCE(_mlevel,1) < 6 THEN
      RETURN jsonb_build_object('status','level_locked','required_level',6,'current_level',COALESCE(_mlevel,1),
        'message','لا تقدر ترسل في الشات إلا بعد وصول سوق السفن للمستوى 6');
    END IF;
  END IF;

  SELECT reason, expires_at INTO _mute_reason, _mute_expires
    FROM public.chat_mutes WHERE user_id=_uid AND active=true AND (expires_at IS NULL OR expires_at>now())
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT cmd.reason, cmd.expires_at INTO _mute_reason, _mute_expires
      FROM public.chat_mute_devices cmd JOIN public.device_accounts da ON da.device_id=cmd.device_id
      WHERE da.user_id=_uid AND cmd.active=true AND (cmd.expires_at IS NULL OR cmd.expires_at>now())
      ORDER BY cmd.created_at DESC LIMIT 1;
  END IF;
  IF _mute_reason IS NULL AND _mute_expires IS NULL THEN
    SELECT cmi.reason, cmi.expires_at INTO _mute_reason, _mute_expires
      FROM public.chat_mute_ips cmi JOIN public.user_ips ui ON ui.ip=cmi.ip
      WHERE ui.user_id=_uid AND cmi.active=true AND (cmi.expires_at IS NULL OR cmi.expires_at>now())
      ORDER BY cmi.created_at DESC LIMIT 1;
  END IF;
  IF _mute_reason IS NOT NULL OR _mute_expires IS NOT NULL OR public.is_muted(_uid) THEN
    RETURN jsonb_build_object('status','muted_already','reason',COALESCE(_mute_reason,''),'expires_at',_mute_expires,'message','أنت مكتوم حالياً');
  END IF;

  IF _channel='tribe' THEN
    IF _tribe_id IS NULL OR NOT public.is_tribe_member(_uid,_tribe_id) THEN RAISE EXCEPTION 'not tribe member'; END IF;
  ELSIF _channel='dm' THEN
    IF _recipient_id IS NULL OR _recipient_id=_uid THEN RAISE EXCEPTION 'bad recipient'; END IF;
    IF EXISTS (SELECT 1 FROM public.user_blocks
      WHERE (blocker_id=_uid AND blocked_id=_recipient_id) OR (blocker_id=_recipient_id AND blocked_id=_uid)) THEN
      RETURN jsonb_build_object('status','blocked','message','لا يمكن المراسلة — يوجد حظر بينكما');
    END IF;

    _lo := LEAST(_uid,_recipient_id); _hi := GREATEST(_uid,_recipient_id);
    SELECT * INTO _thread FROM public.dm_threads WHERE user_low=_lo AND user_high=_hi FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.dm_threads(user_low,user_high,status,requester_id,first_message_at,last_request_at)
        VALUES (_lo,_hi,'pending',_uid,now(),now());
      _status := 'request_sent';
    ELSIF _thread.status='accepted' THEN
      NULL;
    ELSIF _thread.status='pending' THEN
      IF _thread.requester_id=_uid THEN
        RETURN jsonb_build_object('status','awaiting_acceptance','message','بانتظار قبول الطرف الآخر — لا يمكن إرسال رسائل إضافية قبل القبول');
      ELSE
        UPDATE public.dm_threads SET status='accepted', responded_at=now() WHERE user_low=_lo AND user_high=_hi;
        _status := 'accepted_and_sent';
      END IF;
    ELSIF _thread.status='rejected' THEN
      IF _thread.requester_id=_uid AND _thread.responded_at IS NOT NULL AND now()-_thread.responded_at < _cooldown THEN
        RETURN jsonb_build_object('status','rejected_cooldown',
          'retry_at', _thread.responded_at + _cooldown,
          'message','تم رفض طلبك السابق — يجب الانتظار ٢٤ ساعة قبل إرسال طلب جديد');
      END IF;
      UPDATE public.dm_threads SET status='pending', requester_id=_uid,
             first_message_at=now(), last_request_at=now(), responded_at=NULL
       WHERE user_low=_lo AND user_high=_hi;
      _status := 'request_sent';
    END IF;
  END IF;

  INSERT INTO public.messages(channel,body,sender_id,recipient_id,tribe_id,
                              reply_to_id,reply_to_body,reply_to_name)
  VALUES (_channel,_body2,_uid,
          CASE WHEN _channel='dm' THEN _recipient_id ELSE NULL END,
          CASE WHEN _channel='tribe' THEN _tribe_id ELSE NULL END,
          _reply_to_id, left(COALESCE(_reply_to_body,''),200), left(COALESCE(_reply_to_name,''),60))
  RETURNING id INTO _msg_id;

  RETURN jsonb_build_object('status',_status,'id',_msg_id,'message_id',_msg_id);
END $$;

-- Backfill: mark existing DM pairs as accepted so no history is lost
INSERT INTO public.dm_threads(user_low,user_high,status,requester_id,first_message_at,responded_at,last_request_at)
SELECT LEAST(sender_id,recipient_id) AS lo, GREATEST(sender_id,recipient_id) AS hi,
       'accepted', LEAST(sender_id,recipient_id),
       MIN(created_at), MIN(created_at), MIN(created_at)
FROM public.messages
WHERE channel='dm' AND recipient_id IS NOT NULL AND sender_id <> recipient_id
GROUP BY LEAST(sender_id,recipient_id), GREATEST(sender_id,recipient_id)
ON CONFLICT (user_low,user_high) DO NOTHING;
