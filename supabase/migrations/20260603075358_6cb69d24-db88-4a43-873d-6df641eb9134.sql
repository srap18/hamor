
-- 1. media_banned flag on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS media_banned boolean NOT NULL DEFAULT false;

-- 2. Trigger to block uploads when banned (extends existing validator)
CREATE OR REPLACE FUNCTION public._validate_profile_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
  banned boolean;
BEGIN
  SELECT media_banned INTO banned FROM public.profiles WHERE id = NEW.user_id;
  IF banned IS TRUE THEN
    RAISE EXCEPTION 'MEDIA_BANNED';
  END IF;
  SELECT count(*) INTO cnt FROM public.profile_media WHERE user_id = NEW.user_id;
  IF cnt >= 20 THEN
    RAISE EXCEPTION 'ALBUM_LIMIT_EXCEEDED';
  END IF;
  IF NEW.media_type = 'video' AND COALESCE(NEW.duration_ms, 0) > 30000 THEN
    RAISE EXCEPTION 'VIDEO_TOO_LONG';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Admin sets username (no cooldown, allows 2-20 chars)
CREATE OR REPLACE FUNCTION public.admin_set_username(_target uuid, _new text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  v := lower(trim(_new));
  IF v !~ '^[a-z0-9_]{2,20}$' THEN RAISE EXCEPTION 'INVALID_USERNAME'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v AND id <> _target) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;
  UPDATE public.profiles SET username = v, username_changed_at = now() WHERE id = _target;
  RETURN jsonb_build_object('username', v);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_username(uuid, text) TO authenticated;

-- 4. Admin sets bio / avatar_url / avatar_emoji
CREATE OR REPLACE FUNCTION public.admin_set_profile_fields(
  _target uuid,
  _bio text DEFAULT NULL,
  _avatar_url text DEFAULT NULL,
  _avatar_emoji text DEFAULT NULL,
  _clear_avatar boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  UPDATE public.profiles
  SET
    bio = COALESCE(LEFT(_bio, 200), bio),
    avatar_url = CASE WHEN _clear_avatar THEN NULL ELSE COALESCE(_avatar_url, avatar_url) END,
    avatar_emoji = COALESCE(NULLIF(_avatar_emoji, ''), avatar_emoji)
  WHERE id = _target;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_fields(uuid, text, text, text, boolean) TO authenticated;

-- 5. Admin wipes profile (bio + avatar + album)
CREATE OR REPLACE FUNCTION public.admin_wipe_profile(_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  DELETE FROM public.profile_media WHERE user_id = _target;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  UPDATE public.profiles
  SET bio = '', avatar_url = NULL
  WHERE id = _target;
  RETURN jsonb_build_object('deleted_media', deleted_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_wipe_profile(uuid) TO authenticated;

-- 6. Admin toggles media ban
CREATE OR REPLACE FUNCTION public.admin_set_media_ban(_target uuid, _banned boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  UPDATE public.profiles SET media_banned = _banned WHERE id = _target;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_media_ban(uuid, boolean) TO authenticated;
