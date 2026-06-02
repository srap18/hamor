-- 1) Track payout state
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS prizes_distributed_at timestamptz;

-- 2) Finalize a single competition: pay top-N tiers, mark as distributed.
CREATE OR REPLACE FUNCTION public.finalize_competition(_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  tier jsonb;
  rank_idx int;
  winner_uid uuid;
  winner_score bigint;
  prize_count int;
  coins_amt bigint;
  gems_amt int;
  xp_amt int;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  IF c.prizes_distributed_at IS NOT NULL THEN RETURN; END IF;
  IF c.ends_at > now() THEN RETURN; END IF;
  IF c.prize_tiers IS NULL OR jsonb_array_length(c.prize_tiers) = 0 THEN
    -- Fallback to legacy single reward as rank-1 prize
    IF (c.reward_coins + c.reward_gems + c.reward_xp) > 0 THEN
      c.prize_tiers := jsonb_build_array(jsonb_build_object(
        'rank', 1,
        'coins', c.reward_coins,
        'gems', c.reward_gems,
        'xp', c.reward_xp,
        'text', c.reward_text
      ));
    ELSE
      UPDATE public.competitions SET prizes_distributed_at = now() WHERE id = _competition_id;
      RETURN;
    END IF;
  END IF;

  prize_count := jsonb_array_length(c.prize_tiers);

  -- Build leaderboard of top prize_count players for this competition's metric
  FOR rank_idx, winner_uid, winner_score IN
    SELECT row_number() OVER (ORDER BY score DESC, user_id) AS rn, user_id, score
    FROM (
      SELECT CASE
        WHEN c.metric = 'explode_count'  THEN (
          SELECT a.attacker_id FROM public.attacks a
           WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
             AND a.damage_dealt > 0
        )
        ELSE NULL::uuid END AS user_id_unused
    ) noop
    JOIN LATERAL (
      SELECT user_id, score FROM (
        -- explode_count
        SELECT a.attacker_id AS user_id, COUNT(*)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_count'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
          AND a.damage_dealt > 0
        GROUP BY a.attacker_id
        UNION ALL
        -- explode_damage
        SELECT a.attacker_id AS user_id, COALESCE(SUM(a.damage_dealt),0)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_damage'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
        GROUP BY a.attacker_id
        UNION ALL
        -- fish_total
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_total'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
        GROUP BY cc.user_id
        UNION ALL
        -- fish_specific
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_specific'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
          AND cc.fish_id = c.target_fish_id
        GROUP BY cc.user_id
      ) all_metrics
      WHERE user_id IS NOT NULL AND score > 0
    ) lb ON TRUE
    LIMIT prize_count
  LOOP
    tier := c.prize_tiers -> (rank_idx - 1);
    IF tier IS NULL THEN EXIT; END IF;
    coins_amt := COALESCE((tier->>'coins')::bigint, 0);
    gems_amt  := COALESCE((tier->>'gems')::int, 0);
    xp_amt    := COALESCE((tier->>'xp')::int, 0);
    IF (coins_amt + gems_amt + xp_amt) > 0 THEN
      PERFORM public._mutate_currency(winner_uid, coins_amt, gems_amt, 0, xp_amt);
    END IF;
  END LOOP;

  UPDATE public.competitions
     SET prizes_distributed_at = now()
   WHERE id = _competition_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_competition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_competition(uuid) TO authenticated, service_role;

-- 3) Finalize every overdue competition
CREATE OR REPLACE FUNCTION public.finalize_due_competitions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  FOR _id IN
    SELECT id FROM public.competitions
     WHERE active = true
       AND ends_at <= now()
       AND prizes_distributed_at IS NULL
  LOOP
    PERFORM public.finalize_competition(_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_due_competitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_due_competitions() TO anon, authenticated, service_role;

-- 4) get_active_competitions: return ALL active rows (ended included),
-- and auto-finalize overdue ones first so winners get paid.
DROP FUNCTION IF EXISTS public.get_active_competitions();

CREATE OR REPLACE FUNCTION public.get_active_competitions()
 RETURNS TABLE(
   id uuid, title text, description text, banner_emoji text, banner_text text,
   banner_theme text, metric text, target_fish_id text, hide_target boolean,
   reward_coins bigint, reward_gems integer, reward_xp integer, reward_text text,
   starts_at timestamp with time zone, ends_at timestamp with time zone,
   prize_tiers jsonb, prizes_distributed_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  -- Best-effort auto-finalize (STABLE function cannot mutate; ignore failure)
  BEGIN
    PERFORM public.finalize_due_competitions();
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN QUERY
  SELECT
    c.id, c.title, c.description, c.banner_emoji, c.banner_text, c.banner_theme,
    c.metric,
    CASE WHEN c.hide_target AND NOT is_admin(auth.uid()) THEN NULL ELSE c.target_fish_id END,
    c.hide_target,
    c.reward_coins, c.reward_gems, c.reward_xp, c.reward_text,
    c.starts_at, c.ends_at,
    c.prize_tiers,
    c.prizes_distributed_at
  FROM public.competitions c
  WHERE c.active = true
  ORDER BY (c.ends_at > now()) DESC, c.starts_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_competitions() TO anon, authenticated;