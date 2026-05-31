
-- 1) Competitions table
CREATE TABLE public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  banner_emoji text NOT NULL DEFAULT '🏆',
  banner_text text NOT NULL DEFAULT '',
  banner_theme text NOT NULL DEFAULT 'gold', -- gold | royal | inferno | ocean | emerald
  metric text NOT NULL CHECK (metric IN ('explode_count','explode_damage','fish_total','fish_specific')),
  target_fish_id text,
  hide_target boolean NOT NULL DEFAULT false,
  reward_coins bigint NOT NULL DEFAULT 0,
  reward_gems integer NOT NULL DEFAULT 0,
  reward_xp integer NOT NULL DEFAULT 0,
  reward_text text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.competitions TO anon, authenticated;
GRANT ALL ON public.competitions TO service_role;

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY comp_all_view ON public.competitions FOR SELECT USING (true);
CREATE POLICY comp_admin_manage ON public.competitions FOR ALL
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE INDEX competitions_active_idx ON public.competitions (active, ends_at);

-- 2) Catch log (so sold fish still count)
CREATE TABLE public.competition_catches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fish_id text NOT NULL,
  caught_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.competition_catches TO authenticated;
GRANT ALL ON public.competition_catches TO service_role;

ALTER TABLE public.competition_catches ENABLE ROW LEVEL SECURITY;

CREATE POLICY cc_admin_view ON public.competition_catches FOR SELECT
  USING (is_admin(auth.uid()) OR auth.uid() = user_id);

CREATE INDEX cc_user_time_idx ON public.competition_catches (user_id, caught_at);
CREATE INDEX cc_fish_time_idx ON public.competition_catches (fish_id, caught_at);

-- 3) Trigger: log every fish stock insert
CREATE OR REPLACE FUNCTION public.log_competition_catch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.competition_catches(user_id, fish_id, caught_at)
  VALUES (NEW.user_id, NEW.fish_id, COALESCE(NEW.caught_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_competition_catch ON public.fish_stock;
CREATE TRIGGER trg_log_competition_catch
AFTER INSERT ON public.fish_stock
FOR EACH ROW EXECUTE FUNCTION public.log_competition_catch();

-- 4) Get active competitions (hides target_fish_id when hide_target=true and viewer is not admin)
CREATE OR REPLACE FUNCTION public.get_active_competitions()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  banner_emoji text,
  banner_text text,
  banner_theme text,
  metric text,
  target_fish_id text,
  hide_target boolean,
  reward_coins bigint,
  reward_gems integer,
  reward_xp integer,
  reward_text text,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.title, c.description, c.banner_emoji, c.banner_text, c.banner_theme,
    c.metric,
    CASE WHEN c.hide_target AND NOT is_admin(auth.uid()) THEN NULL ELSE c.target_fish_id END,
    c.hide_target,
    c.reward_coins, c.reward_gems, c.reward_xp, c.reward_text,
    c.starts_at, c.ends_at
  FROM public.competitions c
  WHERE c.active = true
    AND c.ends_at > now()
  ORDER BY c.starts_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_competitions() TO anon, authenticated;

-- 5) Leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level integer,
  score bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN
    RETURN;
  END IF;

  IF c.metric = 'explode_count' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND a.damage_dealt > 0
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 30;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 30;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 30;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 30;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_leaderboard(uuid) TO anon, authenticated;
