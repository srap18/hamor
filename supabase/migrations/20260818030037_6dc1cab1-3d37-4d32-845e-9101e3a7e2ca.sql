CREATE OR REPLACE FUNCTION public.is_muted(_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_other uuid;
  v jsonb;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;

  -- direct mute
  IF EXISTS (
    SELECT 1 FROM public.chat_mutes
     WHERE user_id = _user AND active = true
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN true;
  END IF;

  IF public.is_admin(_user) THEN RETURN false; END IF;

  -- device-linked mute: only score peers that are actually muted
  FOR v_other IN
    SELECT c.other_id
      FROM public.device_peer_candidates(_user) c
     WHERE EXISTS (
       SELECT 1 FROM public.chat_mutes cm
        WHERE cm.user_id = c.other_id
          AND cm.active = true
          AND (cm.expires_at IS NULL OR cm.expires_at > now())
          AND COALESCE(cm.scope, 'both') IN ('device', 'both')
     )
  LOOP
    v := public.device_match_score(_user, v_other);
    IF (v->>'score')::int >= 80 AND (v->>'signals')::int >= 2 THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;