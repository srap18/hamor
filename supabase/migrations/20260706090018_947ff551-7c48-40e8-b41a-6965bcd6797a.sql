-- 1) Add metric column (fish | gold), default fish for backward compat.
ALTER TABLE public.tribe_fish_events
  ADD COLUMN IF NOT EXISTS metric text NOT NULL DEFAULT 'fish';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tribe_fish_events_metric_check'
  ) THEN
    ALTER TABLE public.tribe_fish_events
      ADD CONSTRAINT tribe_fish_events_metric_check
      CHECK (metric IN ('fish','gold'));
  END IF;
END $$;

-- 2) Metric-aware tribe leaderboard.
CREATE OR REPLACE FUNCTION public.tribe_fish_event_leaderboard(p_event_id uuid)
RETURNS TABLE(tribe_id uuid, tribe_name text, tribe_emblem text, tribe_banner text, members_count bigint, total_fish bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_metric text;
  v_starts timestamptz;
  v_ends   timestamptz;
BEGIN
  SELECT e.metric, e.starts_at, e.ends_at
    INTO v_metric, v_starts, v_ends
  FROM public.tribe_fish_events e WHERE e.id = p_event_id;

  IF v_metric IS NULL THEN
    RETURN;
  END IF;

  IF v_metric = 'gold' THEN
    RETURN QUERY
    WITH sums AS (
      SELECT d.tribe_id AS tid, SUM(d.amount)::bigint AS total
      FROM public.tribe_donations d
      WHERE d.created_at >= v_starts
        AND d.created_at <= v_ends
      GROUP BY d.tribe_id
    )
    SELECT
      t.id, t.name, t.emblem, t.banner,
      (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
      COALESCE(s.total, 0)::bigint
    FROM public.tribes t
    LEFT JOIN sums s ON s.tid = t.id
    WHERE COALESCE(s.total, 0) > 0
    ORDER BY COALESCE(s.total, 0) DESC, t.name ASC;
  ELSE
    RETURN QUERY
    WITH catches AS (
      SELECT cc.tribe_id AS tid, SUM(cc.qty)::bigint AS total
      FROM public.competition_catches cc
      WHERE cc.tribe_id IS NOT NULL
        AND cc.caught_at >= v_starts
        AND cc.caught_at <= v_ends
      GROUP BY cc.tribe_id
    )
    SELECT
      t.id, t.name, t.emblem, t.banner,
      (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
      COALESCE(c.total, 0)::bigint
    FROM public.tribes t
    LEFT JOIN catches c ON c.tid = t.id
    WHERE COALESCE(c.total, 0) > 0
    ORDER BY COALESCE(c.total, 0) DESC, t.name ASC;
  END IF;
END;
$function$;

-- 3) Metric-aware per-tribe member leaderboard.
CREATE OR REPLACE FUNCTION public.tribe_fish_event_member_leaderboard(p_event_id uuid, p_tribe_id uuid)
RETURNS TABLE(user_id uuid, username text, avatar_url text, total_fish bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_metric text;
  v_starts timestamptz;
  v_ends   timestamptz;
BEGIN
  SELECT e.metric, e.starts_at, e.ends_at
    INTO v_metric, v_starts, v_ends
  FROM public.tribe_fish_events e WHERE e.id = p_event_id;

  IF v_metric IS NULL THEN
    RETURN;
  END IF;

  IF v_metric = 'gold' THEN
    RETURN QUERY
    SELECT
      p.id,
      COALESCE(p.username, 'لاعب'),
      p.avatar_url,
      COALESCE(SUM(d.amount), 0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.tribe_donations d
      ON d.user_id = p.id
     AND d.tribe_id = p_tribe_id
     AND d.created_at >= v_starts
     AND d.created_at <= v_ends
    WHERE p.tribe_id = p_tribe_id
    GROUP BY p.id, p.username, p.avatar_url
    HAVING COALESCE(SUM(d.amount), 0) > 0
    ORDER BY total_fish DESC, p.username ASC
    LIMIT 50;
  ELSE
    RETURN QUERY
    SELECT
      p.id,
      COALESCE(p.username, 'لاعب'),
      p.avatar_url,
      COALESCE(SUM(cc.qty), 0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.competition_catches cc
      ON cc.user_id = p.id
     AND cc.caught_at >= v_starts
     AND cc.caught_at <= v_ends
    WHERE p.tribe_id = p_tribe_id
    GROUP BY p.id, p.username, p.avatar_url
    HAVING COALESCE(SUM(cc.qty), 0) > 0
    ORDER BY total_fish DESC, p.username ASC
    LIMIT 50;
  END IF;
END;
$function$;