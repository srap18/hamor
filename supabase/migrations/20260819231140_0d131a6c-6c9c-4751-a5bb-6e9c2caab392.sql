CREATE OR REPLACE FUNCTION public.chat_promo_match(_body text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _flat text;
  _t text;
  _pair text[];
  _single text[] := ARRAY[
    'ملوك','اعماق','الاعماق','قوقل','جوجل','google','بلايستور','بلاستور','playstore','googleplay',
    'appstore','ابستور','ايستور','متجرقوقل','متجرجوجل','متجربلاي'
  ];
  _pairs text[][] := ARRAY[
    ARRAY['اكتب','متجر'], ARRAY['اكتب','ستور'], ARRAY['اكتب','بحث'], ARRAY['اكتب','لعبه'],
    ARRAY['ابحث','متجر'], ARRAY['ابحث','ستور'], ARRAY['ابحث','لعبه'],
    ARRAY['دور','متجر'], ARRAY['دور','لعبه'],
    ARRAY['حمل','لعبه'], ARRAY['حمل','متجر'], ARRAY['حمل','ستور'],
    ARRAY['نزل','لعبه'], ARRAY['نزل','متجر'], ARRAY['نزل','ستور'],
    ARRAY['لعبه','جديده'], ARRAY['العبه','جديده'], ARRAY['تعال','لعبه'],
    ARRAY['سرش','متجر'], ARRAY['search','store']
  ];
BEGIN
  IF length(COALESCE(_body,'')) = 0 THEN RETURN NULL; END IF;

  _flat := replace(public.normalize_contact_text(_body), ' ', '');
  IF _flat IS NULL OR length(_flat) = 0 THEN RETURN NULL; END IF;

  -- Our own game name is allowed: strip it before matching "ملوك".
  _flat := replace(_flat, 'ملوكالقراصنه', '');
  _flat := replace(_flat, 'ملوكالقرصان', '');

  FOREACH _t IN ARRAY _single LOOP
    IF position(replace(public.normalize_contact_text(_t), ' ', '') IN _flat) > 0 THEN
      RETURN _t;
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(_pairs, 1) LOOP
    _pair := ARRAY[_pairs[i][1], _pairs[i][2]];
    IF position(replace(public.normalize_contact_text(_pair[1]), ' ', '') IN _flat) > 0
       AND position(replace(public.normalize_contact_text(_pair[2]), ' ', '') IN _flat) > 0 THEN
      RETURN _pair[1] || ' ' || _pair[2];
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.chat_promo_match(text) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.send_chat_message_safe(_channel text, _body text, _recipient_id uuid DEFAULT NULL::uuid, _tribe_id uuid DEFAULT NULL::uuid, _reply_to_id uuid DEFAULT NULL::uuid, _reply_to_body text DEFAULT NULL::text, _reply_to_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _msg_id uuid;
  _body2 text := btrim(COALESCE(_body,''));
  _mute_reason text;
  _mute_expires timestamptz;
  _lo uuid;
  _hi uuid;
  _thread record;
  _cooldown interval := interval '24 hours';
  _status text := 'sent';
  _lvl int;
  _recent text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body2)=0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body2)>500 THEN _body2 := left(_body2,500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  _lvl := public.effective_market_level(_uid);
  IF COALESCE(_lvl,1) < 14 THEN
    RETURN jsonb_build_object('status','level_locked','current_level',COALESCE(_lvl,1),'required_level',14,
      'message','لا تقدر ترسل إلا بعد وصول سوق السفن للمستوى 14');
  END IF;

  SELECT reason, expires_at INTO _mute_reason, _mute_expires
    FROM public.chat_mutes
   WHERE user_id=_uid AND active=true AND (expires_at IS NULL OR expires_at>now())
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    SELECT cmd.reason, cmd.expires_at INTO _mute_reason, _mute_expires
      FROM public.device_accounts da
      JOIN public.chat_mute_devices cmd ON cmd.device_id=da.device_id
     WHERE da.user_id=_uid AND cmd.active=true AND (cmd.expires_at IS NULL OR cmd.expires_at>now())
     ORDER BY cmd.created_at DESC LIMIT 1;
  END IF;

  IF _mute_reason IS NULL AND _mute_expires IS NULL THEN
    SELECT cmi.reason, cmi.expires_at INTO _mute_reason, _mute_expires
      FROM public.user_ips ui
      JOIN public.chat_mute_ips cmi ON cmi.ip=ui.ip
     WHERE ui.user_id=_uid AND cmi.active=true AND (cmi.expires_at IS NULL OR cmi.expires_at>now())
     ORDER BY cmi.created_at DESC LIMIT 1;
  END IF;

  IF _mute_reason IS NOT NULL OR _mute_expires IS NOT NULL THEN
    RETURN jsonb_build_object('status','muted_already','reason',COALESCE(_mute_reason,''),'expires_at',_mute_expires,'message','أنت مكتوم حالياً');
  END IF;

  -- Outside-promo / rival-game wording: silently dropped (single message,
  -- or split word-by-word across the sender's last few messages).
  IF public.chat_promo_match(_body2) IS NOT NULL THEN
    RETURN jsonb_build_object('status','promo_blocked','message','');
  END IF;

  SELECT string_agg(m.body, ' ') INTO _recent FROM (
    SELECT body, created_at FROM public.messages
     WHERE sender_id=_uid AND channel=_channel
       AND created_at > now() - interval '5 minutes'
       AND (_channel <> 'dm' OR recipient_id = _recipient_id)
       AND (_channel <> 'tribe' OR tribe_id = _tribe_id)
     ORDER BY created_at DESC
     LIMIT 6
  ) m;

  IF _recent IS NOT NULL AND public.chat_promo_match(_recent || ' ' || _body2) IS NOT NULL THEN
    RETURN jsonb_build_object('status','promo_blocked','message','');
  END IF;

  IF _channel='dm' AND public.dm_contact_match(_body2) IS NOT NULL THEN
    RETURN jsonb_build_object('status','contact_blocked',
      'message','🚫 ممنوع مشاركة حسابات التواصل أو اليوزرات أو الأرقام في الخاص');
  END IF;

  IF _channel='tribe' THEN
    IF _tribe_id IS NULL OR NOT public.is_tribe_member(_uid,_tribe_id) THEN RAISE EXCEPTION 'not tribe member'; END IF;
  ELSIF _channel='dm' THEN
    IF _recipient_id IS NULL OR _recipient_id=_uid THEN RAISE EXCEPTION 'bad recipient'; END IF;
    IF EXISTS (SELECT 1 FROM public.user_blocks
      WHERE (blocker_id=_uid AND blocked_id=_recipient_id) OR (blocker_id=_recipient_id AND blocked_id=_uid)) THEN
      RETURN jsonb_build_object('status','blocked','message','لا يمكن المراسلة — يوجد حظر بينكما');
    END IF;

    _lo := LEAST(_uid,_recipient_id);
    _hi := GREATEST(_uid,_recipient_id);
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
        RETURN jsonb_build_object('status','rejected_cooldown','retry_at',_thread.responded_at + _cooldown,
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
          _reply_to_id,left(COALESCE(_reply_to_body,''),200),left(COALESCE(_reply_to_name,''),60))
  RETURNING id INTO _msg_id;

  RETURN jsonb_build_object('status',_status,'id',_msg_id,'message_id',_msg_id);
END;
$function$;