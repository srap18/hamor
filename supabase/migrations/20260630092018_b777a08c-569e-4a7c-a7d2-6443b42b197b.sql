
CREATE OR REPLACE FUNCTION public.gift_gems(_recipient uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s uuid := auth.uid();
  _b int;
  _s_created timestamptz;
  _s_level int;
  _r_exists boolean;
  _sent_24h bigint;
  _daily_cap int := 5000;
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('ok',false,'error','يجب تسجيل الدخول'); END IF;
  IF _s = _recipient THEN RETURN jsonb_build_object('ok',false,'error','لا يمكن الإرسال لنفسك'); END IF;
  IF _amount IS NULL OR _amount < 1 THEN RETURN jsonb_build_object('ok',false,'error','المبلغ غير صحيح'); END IF;
  IF _amount > _daily_cap THEN
    RETURN jsonb_build_object('ok',false,'error','أقصى مبلغ في الإرسال الواحد '||_daily_cap||' جوهرة');
  END IF;

  -- Recipient must exist
  SELECT true INTO _r_exists FROM public.profiles WHERE id = _recipient;
  IF _r_exists IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'error','المستلم غير موجود');
  END IF;

  -- Sender account-age + level gate (anti-multi-account farming)
  SELECT created_at, level, gems INTO _s_created, _s_level, _b
    FROM public.profiles WHERE id = _s FOR UPDATE;

  IF _s_created IS NULL OR _s_created > now() - interval '7 days' THEN
    RETURN jsonb_build_object('ok',false,'error','حسابك جديد — لا يمكن إرسال الجواهر قبل مرور 7 أيام');
  END IF;
  IF coalesce(_s_level,0) < 10 THEN
    RETURN jsonb_build_object('ok',false,'error','يلزم مستوى 10 على الأقل لإرسال الجواهر');
  END IF;

  IF _b IS NULL OR _b < _amount THEN
    RETURN jsonb_build_object('ok',false,'error','رصيد جواهرك غير كافٍ');
  END IF;

  -- 24h cap across all recipients
  SELECT COALESCE(SUM((meta->>'amount')::bigint),0) INTO _sent_24h
    FROM public.economy_audit
   WHERE user_id = _s
     AND action = 'gift_gems_out'
     AND created_at > now() - interval '24 hours';

  IF _sent_24h + _amount > _daily_cap THEN
    RETURN jsonb_build_object(
      'ok',false,
      'error','تجاوزت حد إرسال الجواهر اليومي ('||_daily_cap||' خلال 24 ساعة). المتبقي: '||GREATEST(_daily_cap-_sent_24h,0)
    );
  END IF;

  UPDATE public.profiles SET gems = gems - _amount WHERE id = _s;
  UPDATE public.profiles SET gems = gems + _amount WHERE id = _recipient;

  BEGIN
    INSERT INTO public.economy_audit(user_id, action, meta)
    VALUES
      (_s, 'gift_gems_out', jsonb_build_object('recipient',_recipient,'amount',_amount)),
      (_recipient, 'gift_gems_in', jsonb_build_object('sender',_s,'amount',_amount));
  EXCEPTION WHEN OTHERS THEN NULL; -- never block the gift on audit failure
  END;

  RETURN jsonb_build_object('ok',true,'remaining',_b - _amount);
END
$function$;
