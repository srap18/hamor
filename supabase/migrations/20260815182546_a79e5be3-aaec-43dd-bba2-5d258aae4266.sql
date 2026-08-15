
CREATE TABLE IF NOT EXISTS public.event_score_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind text NOT NULL CHECK (event_kind IN ('competition','tribe_event')),
  event_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tribe_id uuid,
  delta bigint NOT NULL,
  reason text,
  admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esa_event ON public.event_score_adjustments(event_kind, event_id);
CREATE INDEX IF NOT EXISTS idx_esa_user ON public.event_score_adjustments(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_esa_tribe ON public.event_score_adjustments(event_id, tribe_id);

GRANT SELECT ON public.event_score_adjustments TO authenticated;
GRANT ALL ON public.event_score_adjustments TO service_role;

ALTER TABLE public.event_score_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read event adjustments" ON public.event_score_adjustments;
CREATE POLICY "admins read event adjustments" ON public.event_score_adjustments
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- ── base score helpers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._evt_base_user(_kind text, _event_id uuid, _user uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c RECORD; ev RECORD; v bigint := 0; v_tribe uuid;
BEGIN
  IF _user IS NULL THEN RETURN 0; END IF;

  IF _kind = 'competition' THEN
    SELECT * INTO c FROM public.competitions WHERE id = _event_id;
    IF c IS NULL THEN RETURN 0; END IF;
    IF c.metric = 'explode_count' THEN
      SELECT COUNT(*)::bigint INTO v FROM public.attacks a
       WHERE a.attacker_id = _user AND a.damage_dealt > 0
         AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at;
    ELSIF c.metric = 'explode_damage' THEN
      SELECT COALESCE(SUM(a.damage_dealt),0)::bigint INTO v FROM public.attacks a
       WHERE a.attacker_id = _user
         AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at;
    ELSIF c.metric = 'fish_total' THEN
      SELECT COALESCE(SUM(cc.qty),0)::bigint INTO v FROM public.competition_catches cc
       WHERE cc.user_id = _user AND cc.source = 'catch'
         AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at;
    ELSIF c.metric = 'fish_specific' THEN
      SELECT COALESCE(SUM(cc.qty),0)::bigint INTO v FROM public.competition_catches cc
       WHERE cc.user_id = _user AND cc.source = 'catch' AND cc.fish_id = c.target_fish_id
         AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at;
    END IF;

  ELSIF _kind = 'tribe_event' THEN
    SELECT e.metric, e.starts_at, e.ends_at INTO ev FROM public.tribe_fish_events e WHERE e.id = _event_id;
    IF ev IS NULL THEN RETURN 0; END IF;
    SELECT p.tribe_id INTO v_tribe FROM public.profiles p WHERE p.id = _user;
    IF ev.metric = 'gold' THEN
      SELECT COALESCE(SUM(g.amount),0)::bigint INTO v FROM public.tribe_fish_event_gold g
       WHERE g.event_id = _event_id AND g.user_id = _user;
    ELSIF ev.metric IN ('damage','destroy') THEN
      SELECT COALESCE(SUM(CASE WHEN ev.metric='destroy'
                    THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                    ELSE GREATEST(a.damage_dealt,0)::bigint END),0)::bigint INTO v
        FROM public.attacks a
        LEFT JOIN public.profiles pd ON pd.id = a.defender_id
       WHERE a.attacker_id = _user AND v_tribe IS NOT NULL
         AND COALESCE(a.attacker_tribe_id, v_tribe) IS NOT DISTINCT FROM v_tribe
         AND a.attacker_id <> a.defender_id
         AND COALESCE(a.defender_tribe_id, pd.tribe_id) IS DISTINCT FROM v_tribe
         AND a.created_at >= ev.starts_at AND a.created_at <= ev.ends_at;
    ELSE
      SELECT COALESCE(SUM(cc.qty),0)::bigint INTO v FROM public.competition_catches cc
       WHERE cc.user_id = _user AND cc.caught_at >= ev.starts_at AND cc.caught_at <= ev.ends_at;
    END IF;
  END IF;

  RETURN COALESCE(v,0);
END; $$;

CREATE OR REPLACE FUNCTION public._evt_base_tribe(_event_id uuid, _tribe uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ev RECORD; v bigint := 0;
BEGIN
  IF _tribe IS NULL THEN RETURN 0; END IF;
  SELECT e.metric, e.starts_at, e.ends_at INTO ev FROM public.tribe_fish_events e WHERE e.id = _event_id;
  IF ev IS NULL THEN RETURN 0; END IF;

  IF ev.metric = 'gold' THEN
    SELECT COALESCE(SUM(g.amount),0)::bigint INTO v FROM public.tribe_fish_event_gold g
     WHERE g.event_id = _event_id AND g.tribe_id = _tribe;
  ELSIF ev.metric IN ('damage','destroy') THEN
    SELECT COALESCE(SUM(CASE WHEN ev.metric='destroy'
                  THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                  ELSE GREATEST(a.damage_dealt,0)::bigint END),0)::bigint INTO v
      FROM public.attacks a
      LEFT JOIN public.profiles pa ON pa.id = a.attacker_id
      LEFT JOIN public.profiles pd ON pd.id = a.defender_id
     WHERE COALESCE(a.attacker_tribe_id, pa.tribe_id) = _tribe
       AND a.attacker_id <> a.defender_id
       AND COALESCE(a.defender_tribe_id, pd.tribe_id) IS DISTINCT FROM _tribe
       AND a.created_at >= ev.starts_at AND a.created_at <= ev.ends_at;
  ELSE
    SELECT COALESCE(SUM(cc.qty),0)::bigint INTO v FROM public.competition_catches cc
     WHERE cc.tribe_id = _tribe AND cc.caught_at >= ev.starts_at AND cc.caught_at <= ev.ends_at;
  END IF;
  RETURN COALESCE(v,0);
END; $$;

CREATE OR REPLACE FUNCTION public.event_score_total(_kind text, _event_id uuid, _user uuid DEFAULT NULL, _tribe uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE base bigint := 0; adj bigint := 0;
BEGIN
  IF _user IS NOT NULL THEN
    base := public._evt_base_user(_kind, _event_id, _user);
    SELECT COALESCE(SUM(delta),0) INTO adj FROM public.event_score_adjustments
     WHERE event_kind = _kind AND event_id = _event_id AND user_id = _user;
  ELSE
    base := public._evt_base_tribe(_event_id, _tribe);
    SELECT COALESCE(SUM(delta),0) INTO adj FROM public.event_score_adjustments
     WHERE event_kind = 'tribe_event' AND event_id = _event_id AND user_id IS NULL AND tribe_id = _tribe;
  END IF;
  RETURN base + adj;
END; $$;

-- ── admin RPCs ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_adjust_event_points(
  _kind text, _event_id uuid, _delta bigint,
  _user_id uuid DEFAULT NULL, _tribe_id uuid DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v bigint;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin_only'; END IF;
  IF _kind NOT IN ('competition','tribe_event') THEN RAISE EXCEPTION 'bad_kind'; END IF;
  IF _user_id IS NULL AND _tribe_id IS NULL THEN RAISE EXCEPTION 'target_required'; END IF;

  INSERT INTO public.event_score_adjustments(event_kind, event_id, user_id, tribe_id, delta, reason, admin_id)
  VALUES (_kind, _event_id, _user_id, CASE WHEN _user_id IS NULL THEN _tribe_id ELSE NULL END, _delta, _reason, auth.uid());

  v := public.event_score_total(_kind, _event_id, _user_id, _tribe_id);
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_zero_event_points(
  _kind text, _event_id uuid, _user_id uuid DEFAULT NULL, _tribe_id uuid DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur bigint;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin_only'; END IF;
  cur := public.event_score_total(_kind, _event_id, _user_id, _tribe_id);
  IF cur <> 0 THEN
    PERFORM public.admin_adjust_event_points(_kind, _event_id, -cur, _user_id, _tribe_id, COALESCE(_reason,'zero'));
  END IF;
  RETURN 0;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_event_points(text,uuid,bigint,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_zero_event_points(text,uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_score_total(text,uuid,uuid,uuid) TO authenticated;

-- ── leaderboards now include adjustments ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, score bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT a.attacker_id AS pid, COUNT(*)::bigint AS sc
      FROM public.attacks a
     WHERE c.metric = 'explode_count' AND a.damage_dealt > 0
       AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
     GROUP BY a.attacker_id
    UNION ALL
    SELECT a.attacker_id, COALESCE(SUM(a.damage_dealt),0)::bigint
      FROM public.attacks a
     WHERE c.metric = 'explode_damage'
       AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
     GROUP BY a.attacker_id
    UNION ALL
    SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint
      FROM public.competition_catches cc
     WHERE c.metric = 'fish_total' AND cc.source = 'catch'
       AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
     GROUP BY cc.user_id
    UNION ALL
    SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint
      FROM public.competition_catches cc
     WHERE c.metric = 'fish_specific' AND cc.source = 'catch' AND cc.fish_id = c.target_fish_id
       AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
     GROUP BY cc.user_id
    UNION ALL
    SELECT e.user_id, SUM(e.delta)::bigint
      FROM public.event_score_adjustments e
     WHERE e.event_kind = 'competition' AND e.event_id = _competition_id AND e.user_id IS NOT NULL
     GROUP BY e.user_id
  ), agg AS (
    SELECT r.pid, SUM(r.sc)::bigint AS sc FROM raw r WHERE r.pid IS NOT NULL GROUP BY r.pid
  )
  SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, g.sc
    FROM agg g JOIN public.profiles p ON p.id = g.pid
   WHERE g.sc > 0 AND NOT public.is_admin(p.id)
   ORDER BY g.sc DESC LIMIT 100;
END; $$;

CREATE OR REPLACE FUNCTION public.tribe_fish_event_leaderboard(p_event_id uuid)
RETURNS TABLE(tribe_id uuid, tribe_name text, tribe_emblem text, tribe_banner text, members_count bigint, total_fish bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_metric text; v_starts timestamptz; v_ends timestamptz;
BEGIN
  SELECT e.metric, e.starts_at, e.ends_at INTO v_metric, v_starts, v_ends
  FROM public.tribe_fish_events e WHERE e.id = p_event_id;
  IF v_metric IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT g.tribe_id AS tid, SUM(g.amount)::bigint AS total
      FROM public.tribe_fish_event_gold g
     WHERE v_metric = 'gold' AND g.event_id = p_event_id
     GROUP BY g.tribe_id
    UNION ALL
    SELECT COALESCE(a.attacker_tribe_id, pa.tribe_id),
           SUM(CASE WHEN v_metric = 'destroy'
                    THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                    ELSE GREATEST(a.damage_dealt, 0)::bigint END)::bigint
      FROM public.attacks a
      LEFT JOIN public.profiles pa ON pa.id = a.attacker_id
      LEFT JOIN public.profiles pd ON pd.id = a.defender_id
     WHERE v_metric IN ('damage','destroy')
       AND COALESCE(a.attacker_tribe_id, pa.tribe_id) IS NOT NULL
       AND a.attacker_id <> a.defender_id
       AND COALESCE(a.defender_tribe_id, pd.tribe_id) IS DISTINCT FROM COALESCE(a.attacker_tribe_id, pa.tribe_id)
       AND a.created_at >= v_starts AND a.created_at <= v_ends
     GROUP BY COALESCE(a.attacker_tribe_id, pa.tribe_id)
    UNION ALL
    SELECT cc.tribe_id, SUM(cc.qty)::bigint
      FROM public.competition_catches cc
     WHERE v_metric NOT IN ('gold','damage','destroy')
       AND cc.tribe_id IS NOT NULL AND cc.caught_at >= v_starts AND cc.caught_at <= v_ends
     GROUP BY cc.tribe_id
    UNION ALL
    SELECT COALESCE(e.tribe_id, pm.tribe_id), SUM(e.delta)::bigint
      FROM public.event_score_adjustments e
      LEFT JOIN public.profiles pm ON pm.id = e.user_id
     WHERE e.event_kind = 'tribe_event' AND e.event_id = p_event_id
     GROUP BY COALESCE(e.tribe_id, pm.tribe_id)
  ), agg AS (
    SELECT r.tid, SUM(r.total)::bigint AS total FROM raw r WHERE r.tid IS NOT NULL GROUP BY r.tid
  )
  SELECT t.id, t.name, t.emblem, t.banner,
    (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
    g.total
  FROM agg g JOIN public.tribes t ON t.id = g.tid
  WHERE g.total > 0
  ORDER BY g.total DESC, t.name ASC;
END; $$;

CREATE OR REPLACE FUNCTION public.tribe_fish_event_member_leaderboard(p_event_id uuid, p_tribe_id uuid)
RETURNS TABLE(user_id uuid, username text, avatar_url text, total_fish bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_metric text; v_starts timestamptz; v_ends timestamptz;
BEGIN
  SELECT e.metric, e.starts_at, e.ends_at INTO v_metric, v_starts, v_ends
  FROM public.tribe_fish_events e WHERE e.id = p_event_id;
  IF v_metric IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH mem AS (SELECT p.id, p.username, p.avatar_url FROM public.profiles p WHERE p.tribe_id = p_tribe_id),
  raw AS (
    SELECT g.user_id AS pid, SUM(g.amount)::bigint AS sc
      FROM public.tribe_fish_event_gold g
     WHERE v_metric = 'gold' AND g.event_id = p_event_id AND g.tribe_id = p_tribe_id
     GROUP BY g.user_id
    UNION ALL
    SELECT a.attacker_id,
           SUM(CASE WHEN v_metric = 'destroy'
                    THEN (CASE WHEN a.attacker_won THEN 1 ELSE 0 END)::bigint
                    ELSE GREATEST(a.damage_dealt, 0)::bigint END)::bigint
      FROM public.attacks a
      LEFT JOIN public.profiles pa ON pa.id = a.attacker_id
      LEFT JOIN public.profiles pd ON pd.id = a.defender_id
     WHERE v_metric IN ('damage','destroy')
       AND COALESCE(a.attacker_tribe_id, pa.tribe_id) = p_tribe_id
       AND a.attacker_id <> a.defender_id
       AND COALESCE(a.defender_tribe_id, pd.tribe_id) IS DISTINCT FROM p_tribe_id
       AND a.created_at >= v_starts AND a.created_at <= v_ends
     GROUP BY a.attacker_id
    UNION ALL
    SELECT cc.user_id, SUM(cc.qty)::bigint
      FROM public.competition_catches cc
     WHERE v_metric NOT IN ('gold','damage','destroy')
       AND cc.caught_at >= v_starts AND cc.caught_at <= v_ends
     GROUP BY cc.user_id
    UNION ALL
    SELECT e.user_id, SUM(e.delta)::bigint
      FROM public.event_score_adjustments e
     WHERE e.event_kind = 'tribe_event' AND e.event_id = p_event_id AND e.user_id IS NOT NULL
     GROUP BY e.user_id
  ), agg AS (
    SELECT r.pid, SUM(r.sc)::bigint AS sc FROM raw r WHERE r.pid IS NOT NULL GROUP BY r.pid
  )
  SELECT m.id, COALESCE(m.username,'لاعب'), m.avatar_url, g.sc
    FROM agg g JOIN mem m ON m.id = g.pid
   WHERE g.sc > 0
   ORDER BY g.sc DESC, m.username ASC
   LIMIT 50;
END; $$;
