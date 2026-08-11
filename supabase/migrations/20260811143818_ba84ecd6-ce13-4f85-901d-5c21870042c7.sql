SET lock_timeout = '15s';

ALTER TABLE public.attacks
  ADD COLUMN IF NOT EXISTS attacker_tribe_id uuid,
  ADD COLUMN IF NOT EXISTS defender_tribe_id uuid;

CREATE INDEX IF NOT EXISTS idx_attacks_atk_tribe_created
  ON public.attacks (attacker_tribe_id, created_at DESC)
  WHERE attacker_tribe_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._stamp_attack_tribes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.attacker_tribe_id IS NULL THEN
    SELECT p.tribe_id INTO NEW.attacker_tribe_id FROM public.profiles p WHERE p.id = NEW.attacker_id;
  END IF;
  IF NEW.defender_tribe_id IS NULL THEN
    SELECT p.tribe_id INTO NEW.defender_tribe_id FROM public.profiles p WHERE p.id = NEW.defender_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_attack_tribes ON public.attacks;
CREATE TRIGGER trg_stamp_attack_tribes
BEFORE INSERT ON public.attacks
FOR EACH ROW EXECUTE FUNCTION public._stamp_attack_tribes();

ALTER TABLE public.tribe_fish_events DROP CONSTRAINT IF EXISTS tribe_fish_events_metric_check;
ALTER TABLE public.tribe_fish_events
  ADD CONSTRAINT tribe_fish_events_metric_check
  CHECK (metric = ANY (ARRAY['fish'::text, 'gold'::text, 'damage'::text, 'destroy'::text]));

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
      SELECT g.tribe_id AS tid, SUM(g.amount)::bigint AS total
      FROM public.tribe_fish_event_gold g
      WHERE g.event_id = p_event_id
      GROUP BY g.tribe_id
    )
    SELECT
      t.id, t.name, t.emblem, t.banner,
      (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
      COALESCE(s.total, 0)::bigint
    FROM public.tribes t
    LEFT JOIN sums s ON s.tid = t.id
    WHERE COALESCE(s.total, 0) > 0
    ORDER BY COALESCE(s.total, 0) DESC, t.name ASC;

  ELSIF v_metric IN ('damage','destroy') THEN
    RETURN QUERY
    WITH hits AS (
      SELECT a.attacker_tribe_id AS tid,
             SUM(CASE WHEN v_metric = 'destroy'
                      THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                      ELSE GREATEST(a.damage_dealt, 0)::bigint END)::bigint AS total
      FROM public.attacks a
      WHERE a.attacker_tribe_id IS NOT NULL
        AND a.attacker_id <> a.defender_id
        AND (a.defender_tribe_id IS DISTINCT FROM a.attacker_tribe_id)
        AND a.created_at >= v_starts
        AND a.created_at <= v_ends
      GROUP BY a.attacker_tribe_id
    )
    SELECT
      t.id, t.name, t.emblem, t.banner,
      (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
      COALESCE(h.total, 0)::bigint
    FROM public.tribes t
    LEFT JOIN hits h ON h.tid = t.id
    WHERE COALESCE(h.total, 0) > 0
    ORDER BY COALESCE(h.total, 0) DESC, t.name ASC;

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
      COALESCE(SUM(g.amount), 0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.tribe_fish_event_gold g
      ON g.user_id = p.id
     AND g.event_id = p_event_id
     AND g.tribe_id = p_tribe_id
    WHERE p.tribe_id = p_tribe_id
    GROUP BY p.id, p.username, p.avatar_url
    HAVING COALESCE(SUM(g.amount), 0) > 0
    ORDER BY total_fish DESC, p.username ASC
    LIMIT 50;

  ELSIF v_metric IN ('damage','destroy') THEN
    RETURN QUERY
    SELECT
      p.id,
      COALESCE(p.username, 'لاعب'),
      p.avatar_url,
      COALESCE(SUM(CASE WHEN v_metric = 'destroy'
                        THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                        ELSE GREATEST(a.damage_dealt, 0)::bigint END), 0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.attacks a
      ON a.attacker_id = p.id
     AND a.attacker_tribe_id = p_tribe_id
     AND a.attacker_id <> a.defender_id
     AND (a.defender_tribe_id IS DISTINCT FROM a.attacker_tribe_id)
     AND a.created_at >= v_starts
     AND a.created_at <= v_ends
    WHERE p.tribe_id = p_tribe_id
    GROUP BY p.id, p.username, p.avatar_url
    HAVING COALESCE(SUM(CASE WHEN v_metric = 'destroy'
                             THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                             ELSE GREATEST(a.damage_dealt, 0)::bigint END), 0) > 0
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