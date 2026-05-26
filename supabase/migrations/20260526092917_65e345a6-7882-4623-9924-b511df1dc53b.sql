
-- 1. Hide sensitive currency/economy fields in profiles from non-owners
DROP POLICY IF EXISTS "profiles_select_all_basic" ON public.profiles;

CREATE POLICY "profiles_select_own_full"
ON public.profiles FOR SELECT
USING (auth.uid() = id OR is_admin(auth.uid()));

-- Public view exposing ONLY safe columns (used for cross-user reads)
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
       name_frame, avatar_frame, selected_bg_id, tribe_id, online_at, created_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;
REVOKE ALL ON public.profiles_public FROM public;

-- RPC for currency-ordered leaderboard (server orders by coins/gems
-- without exposing the actual values to the client)
CREATE OR REPLACE FUNCTION public.get_currency_leaderboard(_col text, _limit int DEFAULT 30)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level int,
  xp int,
  name_frame text,
  avatar_frame text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _col NOT IN ('coins','gems') THEN
    RAISE EXCEPTION 'invalid column';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT id, display_name, avatar_emoji, avatar_url, level, xp, name_frame, avatar_frame
     FROM public.profiles ORDER BY %I DESC NULLS LAST LIMIT $1', _col
  ) USING _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_currency_leaderboard(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_currency_leaderboard(text, int) TO authenticated;

-- 2. Stop broadcasting support_gifts and transactions over realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.support_gifts;
ALTER PUBLICATION supabase_realtime DROP TABLE public.transactions;

-- 3. Defense-in-depth: prevent any path where a non-admin could INSERT into user_roles
CREATE POLICY "user_roles_insert_admin_only"
ON public.user_roles AS RESTRICTIVE FOR INSERT
TO authenticated
WITH CHECK (is_admin(auth.uid()));
