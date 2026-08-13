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
      AND (
        -- same high-confidence hardware identity
        EXISTS (
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
        -- same hardware hash recorded on the identity link
        OR EXISTS (
          SELECT 1
          FROM public.device_identity_users me
          JOIN public.device_identity_users other
            ON other.hardware_hash = me.hardware_hash
          JOIN public.chat_mutes cm ON cm.user_id = other.user_id
          WHERE me.user_id = _user
            AND me.hardware_hash IS NOT NULL
            AND length(me.hardware_hash) >= 16
            AND me.confidence >= 95
            AND other.confidence >= 95
            AND cm.active = true
            AND (cm.expires_at IS NULL OR cm.expires_at > now())
        )
        -- same device slot hardware hash (covers brand-new accounts on a full device)
        OR EXISTS (
          SELECT 1
          FROM public.device_slots s1
          JOIN public.device_slots s2 ON s2.hardware_hash = s1.hardware_hash
          JOIN public.chat_mutes cm ON cm.user_id = s2.user_id
          WHERE s1.user_id = _user
            AND s1.hardware_hash IS NOT NULL
            AND length(s1.hardware_hash) >= 16
            AND cm.active = true
            AND (cm.expires_at IS NULL OR cm.expires_at > now())
        )
      )
    );
$function$;