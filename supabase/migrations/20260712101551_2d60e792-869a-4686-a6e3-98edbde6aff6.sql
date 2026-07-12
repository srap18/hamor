CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _msg text;
  _recent_nuke_count int;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _is_ad boolean := false;
  _kind text;
  _emoji text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;
  IF public.is_muted(_attacker) THEN RAISE EXCEPTION 'muted: you cannot send messages'; END IF;
  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;

  SELECT COUNT(*) INTO _recent_nuke_count FROM public.attacks
   WHERE attacker_id = _attacker AND defender_id = _target_id AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ad_bombs
     WHERE attacker_id = _attacker AND target_user_id = _target_id
       AND started_at > now() - interval '5 minutes'
  ) INTO _is_ad;

  _kind  := CASE WHEN _is_ad THEN 'ad_bomb' ELSE 'nuke' END;
  _emoji := CASE WHEN _is_ad THEN '📺'     ELSE '☢️'   END;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  UPDATE public.profiles SET last_destroyer_message = _msg WHERE id = _target_id;

  INSERT INTO public.destroyer_messages (defender_id, attacker_id, attacker_name, kind, message)
  VALUES (_target_id, _attacker, _attacker_name, _kind, _msg);

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  SELECT _target_id,
         CASE WHEN _is_ad THEN '📺 رسالة القنبلة الإعلانية' ELSE '☢️ رسالة التفجير النووي' END,
         COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' فجّرك وكتب: ' || _msg,
         'attack',
         _attacker,
         jsonb_build_object('event', _kind || '_message', 'message', _msg)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_id = _target_id
      AND created_by = _attacker
      AND kind = 'attack'
      AND meta->>'event' = _kind || '_message'
      AND created_at > now() - interval '5 minutes'
  );

  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES (_kind, _attacker, COALESCE(_attacker_name, 'لاعب'), _target_id, COALESCE(_target_name, 'لاعب'), _msg, _emoji);
END;
$function$;