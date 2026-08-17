
CREATE OR REPLACE FUNCTION public.normalize_contact_text(_t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE s text := lower(COALESCE(_t,''));
BEGIN
  -- diacritics / tatweel / zero-width / bidi
  s := regexp_replace(s, '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g');
  s := regexp_replace(s, '[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]', '', 'g');
  -- arabic-indic digits -> ascii
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  -- unify arabic letters
  s := regexp_replace(s, '[إأآٱا]', 'ا', 'g');
  s := regexp_replace(s, '[ىئي]', 'ي', 'g');
  s := regexp_replace(s, 'ة', 'ه', 'g');
  s := regexp_replace(s, 'ؤ', 'و', 'g');
  s := regexp_replace(s, 'ﮐ|ﻙ|ك|گ|ک', 'ك', 'g');
  s := regexp_replace(s, 'ﭺ|چ', 'ج', 'g');
  s := regexp_replace(s, 'پ', 'ب', 'g');
  s := regexp_replace(s, 'ڤ|ﭪ', 'ف', 'g');
  -- fullwidth latin -> ascii
  s := translate(s,
    'ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ',
    'abcdefghijklmnopqrstuvwxyz');
  -- leet / lookalikes -> latin
  s := translate(s, '0134578@$!|', 'oieastasil');
  -- keep only latin letters, arabic letters and digits; everything else -> space
  s := regexp_replace(s, '[^a-z0-9\u0621-\u064A]+', ' ', 'g');
  -- collapse 2+ repeated chars to one
  s := regexp_replace(s, '(.)\1+', '\1', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  RETURN s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dm_contact_match(_body text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _raw text := lower(COALESCE(_body,''));
  _norm text := public.normalize_contact_text(_body);
  _flat text := replace(public.normalize_contact_text(_body), ' ', '');
  _digits text := regexp_replace(translate(COALESCE(_body,''),'٠١٢٣٤٥٦٧٨٩','0123456789'), '[^0-9]', '', 'g');
  _w text;
  _tok text;
  _ar text[] := ARRAY[
    'سناب','سنابي','سنابشات','تيكتوك','تكتوك','تيك','انستا','انستقرام','انستغرام','انستجرام',
    'واتس','واتساب','وتساب','واتسابي','تلجرام','تليجرام','تيليجرام','تلقرام','تلكرام',
    'دسكورد','ديسكورد','تويتر','فيسبوك','فيس','يوتيوب','سكايب','فايبر','ايمو','بيقو','لايكي',
    'يوزر','يوزري','ايدي','ايديي','معرفي','حسابيفي','تابعني','اضفني','ضفني','ارقمي','جوالي','رقمي','واتسي','زدني','زودني','برهاللعبه','خارجاللعبه'
  ];
  _en text[] := ARRAY[
    'snap','snapchat','tiktok','tik','instagram','insta','whatsapp','watsap','wtsp','telegram','tele','discord',
    'twitter','facebook','youtube','skype','viber','imo','bigo','likee','signal','kik','messenger','zoom','line','wechat','yalla'
  ];
BEGIN
  IF length(COALESCE(_body,'')) = 0 THEN RETURN NULL; END IF;

  -- explicit handles / emails / links
  IF _raw ~ '@[a-z0-9._-]{3,}' THEN RETURN 'handle'; END IF;
  IF _raw ~ '(https?://|www\.|\.com|\.net|\.me|\.gg|t\.me)' THEN RETURN 'link'; END IF;
  -- phone-ish digit runs
  IF length(_digits) >= 7 THEN RETURN 'phone'; END IF;

  FOREACH _w IN ARRAY _ar LOOP
    IF position(public.normalize_contact_text(_w) IN _flat) > 0 THEN RETURN _w; END IF;
  END LOOP;
  FOREACH _w IN ARRAY _en LOOP
    IF _flat ~ ('(^|[^a-z])' || _w || '([^a-z]|$)') OR position(_w IN _flat) > 0 THEN RETURN _w; END IF;
  END LOOP;

  -- any english username-like token (4+ latin chars/digits) except harmless words
  FOREACH _tok IN ARRAY regexp_split_to_array(_norm, ' ') LOOP
    IF _tok ~ '^[a-z][a-z0-9]{3,}$' AND _tok NOT IN (
      'hello','hala','halo','okay','good','nice','great','thanks','thank','please','welcome','sorry',
      'yes','no','love','king','game','play','best','well','cool','wow','haha','lol','bye','level','vip',
      'hamor','molok','deep','king','gold','gems','ship','fish','boss','war','team','club'
    ) THEN
      RETURN 'username';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._block_dm_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.channel = 'dm' AND NEW.body IS NOT NULL AND public.dm_contact_match(NEW.body) IS NOT NULL THEN
    RAISE EXCEPTION 'dm_contact_blocked';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_dm_contact ON public.messages;
CREATE TRIGGER trg_block_dm_contact
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public._block_dm_contact();

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
  _mute_reason text; _mute_expires timestamptz;
  _lo uuid; _hi uuid; _thread record;
  _cooldown interval := interval '24 hours';
  _status text := 'sent';
  _lvl int;
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

  IF _channel='dm' THEN
    IF public.dm_contact_match(_body2) IS NOT NULL THEN
      RETURN jsonb_build_object('status','contact_blocked',
        'message','🚫 ممنوع مشاركة حسابات التواصل أو اليوزرات أو الأرقام في الخاص');
    END IF;
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
END $function$;
