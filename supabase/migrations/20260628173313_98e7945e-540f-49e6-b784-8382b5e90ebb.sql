
SET LOCAL lock_timeout = '20s';
-- Revoke broad UPDATE, then grant only safe columns.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  display_name, bio, avatar_url, avatar_emoji,
  avatar_frame, name_frame, bubble_frame, profile_frame,
  selected_bg_id, album_privacy
) ON public.profiles TO authenticated;
