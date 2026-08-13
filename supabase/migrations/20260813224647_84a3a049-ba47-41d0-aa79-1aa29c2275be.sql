CREATE OR REPLACE FUNCTION public.is_muted(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.chat_mutes
      WHERE user_id = _user
        AND active = true
        AND (expires_at IS NULL OR expires_at > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_mute_devices cmd
      JOIN public.device_accounts da ON da.device_id = cmd.device_id
      WHERE da.user_id = _user
        AND cmd.active = true
        AND (cmd.expires_at IS NULL OR cmd.expires_at > now())
    )
    OR (
      NOT public.is_admin(_user)
      AND EXISTS (
        SELECT 1
        FROM public.device_identity_users me
        JOIN public.device_identities di ON di.id = me.identity_id
        JOIN public.device_identity_users other ON other.identity_id = me.identity_id
        JOIN public.chat_mutes cm ON cm.user_id = other.user_id
        WHERE me.user_id = _user
          AND me.confidence >= 95
          AND other.confidence >= 95
          AND COALESCE(di.is_generic, false) = false
          AND cm.active = true
          AND (cm.expires_at IS NULL OR cm.expires_at > now())
      )
    );
$function$;