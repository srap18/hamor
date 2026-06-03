
-- 1. Columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS username_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';

-- 2. Generate unique username helper
CREATE OR REPLACE FUNCTION public._gen_unique_username()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate text; attempts int := 0;
BEGIN
  LOOP
    candidate := 'user_' || lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate);
    attempts := attempts + 1;
    IF attempts > 50 THEN
      candidate := 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      EXIT;
    END IF;
  END LOOP;
  RETURN candidate;
END; $$;

-- 3. Backfill
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE username IS NULL OR username = '' LOOP
    UPDATE public.profiles SET username = public._gen_unique_username() WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx ON public.profiles (lower(username));

-- 4. Validation + auto-assign triggers
CREATE OR REPLACE FUNCTION public._validate_username()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.username := lower(trim(NEW.username));
  IF NEW.username !~ '^[a-z0-9_]{5,20}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_username_validate_trg ON public.profiles;
CREATE TRIGGER profiles_username_validate_trg
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._validate_username();

CREATE OR REPLACE FUNCTION public._auto_username()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.username IS NULL OR NEW.username = '' THEN
    NEW.username := public._gen_unique_username();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_auto_username_trg ON public.profiles;
CREATE TRIGGER profiles_auto_username_trg
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._auto_username();

-- 5. change_username RPC (14-day cooldown)
CREATE OR REPLACE FUNCTION public.change_username(_new text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cleaned text; last_at timestamptz; next_at timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  cleaned := lower(trim(_new));
  IF cleaned !~ '^[a-z0-9_]{5,20}$' THEN RAISE EXCEPTION 'INVALID_USERNAME'; END IF;
  SELECT username_changed_at INTO last_at FROM public.profiles WHERE id = uid;
  IF last_at IS NOT NULL AND last_at > now() - interval '14 days' THEN
    next_at := last_at + interval '14 days';
    RAISE EXCEPTION 'USERNAME_COOLDOWN' USING HINT = next_at::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = cleaned AND id <> uid) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;
  UPDATE public.profiles SET username = cleaned, username_changed_at = now() WHERE id = uid;
  RETURN jsonb_build_object('ok', true, 'username', cleaned);
END; $$;

GRANT EXECUTE ON FUNCTION public.change_username(text) TO authenticated;

-- 6. Drop & recreate public RPCs with extended return shape
DROP FUNCTION IF EXISTS public.get_profiles_public(uuid[]);
DROP FUNCTION IF EXISTS public.search_profiles_public(text, integer);
DROP FUNCTION IF EXISTS public.get_online_players(integer);

CREATE FUNCTION public.get_profiles_public(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, username text, bio text, avatar_emoji text, avatar_url text, level integer, xp integer, name_frame text, avatar_frame text, bubble_frame text, profile_frame text, selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id,display_name,username,bio,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles WHERE id = ANY(_ids);
$$;

CREATE FUNCTION public.search_profiles_public(_q text, _limit integer DEFAULT 20)
RETURNS TABLE(id uuid, display_name text, username text, bio text, avatar_emoji text, avatar_url text, level integer, xp integer, name_frame text, avatar_frame text, bubble_frame text, profile_frame text, selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id,display_name,username,bio,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles
  WHERE (display_name ILIKE '%'||_q||'%' OR username ILIKE '%'||lower(_q)||'%')
    AND id <> COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY level DESC NULLS LAST LIMIT _limit;
$$;

CREATE FUNCTION public.get_online_players(_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, display_name text, username text, bio text, avatar_emoji text, avatar_url text, level integer, xp integer, name_frame text, avatar_frame text, bubble_frame text, profile_frame text, selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id,display_name,username,bio,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles
  WHERE online_at >= (now() - interval '5 minutes')
    AND id <> COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY online_at DESC LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_by_username(_username text)
RETURNS TABLE(id uuid, display_name text, username text, bio text, avatar_emoji text, avatar_url text, level integer, xp integer, name_frame text, avatar_frame text, bubble_frame text, profile_frame text, selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id,display_name,username,bio,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles
  WHERE lower(username) = lower(_username) LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_profiles_public(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_profiles_public(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_online_players(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_by_username(text) TO anon, authenticated;

-- 7. profile_media table
CREATE TABLE IF NOT EXISTS public.profile_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  media_url text NOT NULL,
  thumbnail_url text,
  duration_ms integer,
  caption text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.profile_media TO authenticated;
GRANT SELECT ON public.profile_media TO anon;
GRANT ALL ON public.profile_media TO service_role;

ALTER TABLE public.profile_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_select_all ON public.profile_media;
DROP POLICY IF EXISTS pm_insert_own ON public.profile_media;
DROP POLICY IF EXISTS pm_delete_own_or_admin ON public.profile_media;

CREATE POLICY pm_select_all ON public.profile_media FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pm_insert_own ON public.profile_media FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY pm_delete_own_or_admin ON public.profile_media FOR DELETE TO authenticated USING (auth.uid() = user_id OR is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS profile_media_user_idx ON public.profile_media(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._validate_profile_media()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cnt int;
BEGIN
  IF length(coalesce(NEW.caption,'')) > 100 THEN RAISE EXCEPTION 'CAPTION_TOO_LONG'; END IF;
  IF NEW.media_type = 'video' AND (NEW.duration_ms IS NULL OR NEW.duration_ms > 30000) THEN
    RAISE EXCEPTION 'VIDEO_TOO_LONG';
  END IF;
  SELECT count(*) INTO cnt FROM public.profile_media WHERE user_id = NEW.user_id;
  IF cnt >= 20 THEN RAISE EXCEPTION 'ALBUM_FULL'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profile_media_validate_trg ON public.profile_media;
CREATE TRIGGER profile_media_validate_trg
  BEFORE INSERT ON public.profile_media
  FOR EACH ROW EXECUTE FUNCTION public._validate_profile_media();
