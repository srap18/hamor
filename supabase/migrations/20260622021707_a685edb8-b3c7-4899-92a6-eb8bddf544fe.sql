
CREATE OR REPLACE FUNCTION public.can_view_album(_viewer uuid, _owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _viewer = _owner
    OR public.is_admin(_viewer)
    OR (
      NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_id = _owner  AND b.blocked_id = _viewer)
           OR (b.blocker_id = _viewer AND b.blocked_id = _owner)
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = _owner AND p.album_privacy = 'public'
        )
        OR EXISTS (
          SELECT 1 FROM public.friends f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = _viewer AND f.addressee_id = _owner) OR
              (f.requester_id = _owner  AND f.addressee_id = _viewer)
            )
        )
      )
    );
$function$;
