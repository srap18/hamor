
DROP VIEW IF EXISTS public.profiles_public;

CREATE OR REPLACE FUNCTION public.get_profiles_public(_ids uuid[])
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level int,
  xp int,
  name_frame text,
  avatar_frame text,
  selected_bg_id text,
  tribe_id uuid,
  online_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
         name_frame, avatar_frame, selected_bg_id, tribe_id, online_at, created_at
  FROM public.profiles
  WHERE id = ANY(_ids);
$$;

REVOKE ALL ON FUNCTION public.get_profiles_public(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_profiles_public(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_profiles_public(_q text, _limit int DEFAULT 20)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level int,
  xp int,
  name_frame text,
  avatar_frame text,
  selected_bg_id text,
  tribe_id uuid,
  online_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
         name_frame, avatar_frame, selected_bg_id, tribe_id, online_at, created_at
  FROM public.profiles
  WHERE display_name ILIKE '%' || _q || '%'
    AND id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY level DESC NULLS LAST
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.search_profiles_public(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.search_profiles_public(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_online_players(_limit int DEFAULT 20)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level int,
  xp int,
  name_frame text,
  avatar_frame text,
  selected_bg_id text,
  tribe_id uuid,
  online_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
         name_frame, avatar_frame, selected_bg_id, tribe_id, online_at, created_at
  FROM public.profiles
  WHERE online_at >= (now() - interval '5 minutes')
    AND id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY online_at DESC
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.get_online_players(int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_online_players(int) TO authenticated;
