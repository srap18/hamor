
-- 1) Add privacy column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS album_privacy text NOT NULL DEFAULT 'public';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_album_privacy_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_album_privacy_chk CHECK (album_privacy IN ('public','friends'));

-- 2) Security definer helper: can the viewer see this album?
CREATE OR REPLACE FUNCTION public.can_view_album(_viewer uuid, _owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _viewer = _owner
    OR public.is_admin(_viewer)
    OR EXISTS (
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
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_album(uuid, uuid) TO anon, authenticated;

-- 3) Replace permissive SELECT policy on profile_media
DROP POLICY IF EXISTS pm_select_all ON public.profile_media;

CREATE POLICY pm_select_visible
ON public.profile_media
FOR SELECT
TO anon, authenticated
USING (public.can_view_album(auth.uid(), user_id));
