CREATE OR REPLACE FUNCTION public.admin_lift_sanction(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid;
  v_affected int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'ban' THEN
    UPDATE public.bans SET active = false
      WHERE id = p_id AND active = true
      RETURNING user_id INTO v_target;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_target IS NOT NULL THEN
      DELETE FROM public.banned_devices WHERE user_id = v_target;
      DELETE FROM public.banned_ips WHERE user_id = v_target;
    END IF;
  ELSIF p_kind = 'mute' THEN
    UPDATE public.chat_mutes SET active = false
      WHERE id = p_id AND active = true
      RETURNING user_id INTO v_target;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    -- chat_mute_devices/ips use mute_id, not user_id
    DELETE FROM public.chat_mute_devices WHERE mute_id = p_id;
    DELETE FROM public.chat_mute_ips WHERE mute_id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  RETURN jsonb_build_object('ok', true, 'affected', v_affected, 'user_id', v_target);
END;
$function$;