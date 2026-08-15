
CREATE OR REPLACE FUNCTION public.my_leaderboard_rank(_kind text, _ref uuid DEFAULT NULL::uuid)
 RETURNS TABLE(rank bigint, score bigint, extra bigint, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  k text := lower(coalesce(_kind,''));
  c RECORD;
  v_score bigint := 0;
  v_extra bigint := 0;
  v_rank bigint := 0;
  v_total bigint := 0;
  v_tribe uuid;
  ev RECORD;
  ws date;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  IF k = 'competition' THEN
    SELECT * INTO c FROM public.competitions WHERE id = _ref;
    IF c IS NULL THEN RETURN; END IF;
    WITH raw AS (
        SELECT a.attacker_id AS pid, COUNT(*)::bigint AS sc
          FROM public.attacks a
         WHERE c.metric = 'explode_count'
           AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at AND a.damage_dealt > 0
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
         WHERE c.metric = 'fish_total'
           AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at AND cc.source = 'catch'
         GROUP BY cc.user_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint
          FROM public.competition_catches cc
         WHERE c.metric = 'fish_specific'
           AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
           AND cc.fish_id = c.target_fish_id AND cc.source = 'catch'
         GROUP BY cc.user_id
        UNION ALL
        SELECT e.user_id, SUM(e.delta)::bigint
          FROM public.event_score_adjustments e
         WHERE e.event_kind = 'competition' AND e.event_id = _ref AND e.user_id IS NOT NULL
         GROUP BY e.user_id
    ), board AS (
      SELECT r.pid, SUM(r.sc)::bigint AS sc
        FROM raw r
       WHERE r.pid IS NOT NULL AND NOT public.is_admin(r.pid)
       GROUP BY r.pid
      HAVING SUM(r.sc) > 0
    )
    SELECT COALESCE((SELECT b.sc FROM board b WHERE b.pid = uid), 0),
           (SELECT COUNT(*) FROM board),
           COALESCE((SELECT COUNT(*) + 1 FROM board b
                      WHERE b.sc > COALESCE((SELECT b2.sc FROM board b2 WHERE b2.pid = uid), 0)), 0)
      INTO v_score, v_total, v_rank;
    IF v_score <= 0 THEN v_rank := 0; END IF;

  ELSIF k = 'weekly_xp' THEN
    SELECT COALESCE(p.weekly_xp,0) INTO v_score
      FROM public.profiles p
      LEFT JOIN public.user_market um ON um.user_id = p.id
     WHERE p.id = uid AND NOT public.is_admin(p.id) AND COALESCE(um.level,1) >= 16;
    v_score := COALESCE(v_score, 0);
    SELECT COUNT(*) INTO v_total
      FROM public.profiles p LEFT JOIN public.user_market um ON um.user_id = p.id
     WHERE p.weekly_xp > 0 AND NOT public.is_admin(p.id) AND COALESCE(um.level,1) >= 16;
    IF v_score > 0 THEN
      SELECT COUNT(*) + 1 INTO v_rank
        FROM public.profiles p LEFT JOIN public.user_market um ON um.user_id = p.id
       WHERE p.weekly_xp > v_score AND NOT public.is_admin(p.id) AND COALESCE(um.level,1) >= 16;
    END IF;

  ELSIF k IN ('coins','gems','xp') THEN
    SELECT CASE k WHEN 'coins' THEN COALESCE(p.coins,0)::bigint
                  WHEN 'gems'  THEN COALESCE(p.gems,0)::bigint
                  ELSE COALESCE(p.xp,0)::bigint END
      INTO v_score FROM public.profiles p WHERE p.id = uid AND NOT public.is_admin(p.id);
    v_score := COALESCE(v_score, 0);
    SELECT COUNT(*) INTO v_total FROM public.profiles p WHERE NOT public.is_admin(p.id);
    SELECT COUNT(*) + 1 INTO v_rank FROM public.profiles p
     WHERE NOT public.is_admin(p.id)
       AND (CASE k WHEN 'coins' THEN COALESCE(p.coins,0)::bigint
                   WHEN 'gems'  THEN COALESCE(p.gems,0)::bigint
                   ELSE COALESCE(p.xp,0)::bigint END) > v_score;

  ELSIF k = 'ships' THEN
    SELECT COALESCE(um.level,0) INTO v_score FROM public.user_market um WHERE um.user_id = uid;
    v_score := COALESCE(v_score, 0);
    SELECT COUNT(*) INTO v_total FROM public.user_market um
      JOIN public.profiles p ON p.id = um.user_id WHERE NOT public.is_admin(p.id);
    IF v_score > 0 AND NOT public.is_admin(uid) THEN
      SELECT COUNT(*) + 1 INTO v_rank FROM public.user_market um
        JOIN public.profiles p ON p.id = um.user_id
       WHERE NOT public.is_admin(p.id) AND um.level > v_score;
    END IF;

  ELSIF k = 'fish' THEN
    WITH species AS (
      SELECT fc.user_id AS pid, fc.fish_id FROM public.fish_caught fc WHERE fc.total_caught > 0
      UNION
      SELECT fs.user_id, fs.fish_id FROM public.fish_stock fs WHERE fs.quantity > 0
    ), agg AS (
      SELECT s.pid, COUNT(DISTINCT s.fish_id)::bigint AS uniq,
             COALESCE((SELECT SUM(fc2.total_caught) FROM public.fish_caught fc2 WHERE fc2.user_id = s.pid),0)::bigint AS tot
        FROM species s GROUP BY s.pid
    ), board AS (
      SELECT a.pid, a.uniq, a.tot FROM agg a
       WHERE a.uniq > 0 AND NOT public.is_admin(a.pid)
    )
    SELECT COALESCE((SELECT b.uniq FROM board b WHERE b.pid = uid),0),
           COALESCE((SELECT b.tot FROM board b WHERE b.pid = uid),0),
           (SELECT COUNT(*) FROM board),
           COALESCE((SELECT COUNT(*) + 1 FROM board b
                      WHERE b.uniq > COALESCE((SELECT b2.uniq FROM board b2 WHERE b2.pid = uid),0)),0)
      INTO v_score, v_extra, v_total, v_rank;
    IF v_score <= 0 THEN v_rank := 0; END IF;

  ELSIF k = 'arena' THEN
    ws := (date_trunc('week', (now() AT TIME ZONE 'UTC')))::date;
    SELECT COALESCE(a.score,0), COALESCE(a.wins,0) INTO v_score, v_extra
      FROM public.arena_scores a WHERE a.user_id = uid AND a.week_start = ws;
    v_score := COALESCE(v_score,0); v_extra := COALESCE(v_extra,0);
    SELECT COUNT(*) INTO v_total FROM public.arena_scores a WHERE a.week_start = ws;
    IF v_score > 0 THEN
      SELECT COUNT(*) + 1 INTO v_rank FROM public.arena_scores a
       WHERE a.week_start = ws AND a.score > v_score;
    END IF;

  ELSIF k IN ('tribe_donations','tribe_damage') THEN
    SELECT p.tribe_id INTO v_tribe FROM public.profiles p WHERE p.id = uid;
    IF v_tribe IS NULL THEN RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint; RETURN; END IF;
    IF k = 'tribe_donations' THEN
      SELECT GREATEST(0, COALESCE(t.total_donations,0))::bigint INTO v_score FROM public.tribes t WHERE t.id = v_tribe;
      SELECT COUNT(*) INTO v_total FROM public.tribes t;
      SELECT COUNT(*) + 1 INTO v_rank FROM public.tribes t
       WHERE GREATEST(0, COALESCE(t.total_donations,0)) > COALESCE(v_score,0);
    ELSE
      WITH ms AS (
        SELECT p.tribe_id AS tid, COALESCE(SUM(GREATEST(p.total_damage_dealt,0)),0)::bigint AS dmg
          FROM public.profiles p WHERE p.tribe_id IS NOT NULL AND NOT public.is_admin(p.id)
         GROUP BY p.tribe_id
      )
      SELECT COALESCE((SELECT m.dmg FROM ms m WHERE m.tid = v_tribe),0),
             (SELECT COUNT(*) FROM ms),
             COALESCE((SELECT COUNT(*) + 1 FROM ms m
                        WHERE m.dmg > COALESCE((SELECT m2.dmg FROM ms m2 WHERE m2.tid = v_tribe),0)),0)
        INTO v_score, v_total, v_rank;
    END IF;
    v_score := COALESCE(v_score,0);

  ELSIF k = 'tribe_event' THEN
    SELECT e.metric, e.starts_at, e.ends_at INTO ev FROM public.tribe_fish_events e WHERE e.id = _ref;
    IF ev IS NULL THEN RETURN; END IF;
    SELECT p.tribe_id INTO v_tribe FROM public.profiles p WHERE p.id = uid;
    v_score := public.event_score_total('tribe_event', _ref, uid, NULL);
    IF v_tribe IS NOT NULL THEN
      SELECT COUNT(*) + 1 INTO v_rank FROM (
        SELECT m.id AS user_id, public.event_score_total('tribe_event', _ref, m.id, NULL) AS sc
        FROM public.profiles m WHERE m.tribe_id = v_tribe
      ) q WHERE q.sc > v_score;
      SELECT COUNT(*) INTO v_total FROM public.profiles m WHERE m.tribe_id = v_tribe;
    END IF;
    IF v_score <= 0 THEN v_rank := 0; END IF;

  ELSE
    RETURN;
  END IF;

  RETURN QUERY SELECT COALESCE(v_rank,0), COALESCE(v_score,0), COALESCE(v_extra,0), COALESCE(v_total,0);
END;
$function$;
