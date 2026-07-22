CREATE OR REPLACE FUNCTION public.record_golden_fisher_competition_catch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event public.competitions%ROWTYPE;
BEGIN
  IF COALESCE(NEW.qty, 0) <= 0 OR NEW.fish_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.* INTO _event
  FROM public.competitions c
  WHERE c.active = true
    AND c.metric IN ('fish_specific', 'fish_total')
    AND NEW.created_at BETWEEN c.starts_at AND c.ends_at
    AND (c.metric = 'fish_total' OR c.target_fish_id = NEW.fish_id)
  ORDER BY c.starts_at DESC
  LIMIT 1;

  IF _event.id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty, source)
  SELECT NEW.user_id, NEW.fish_id, NEW.created_at, NEW.qty::integer, 'catch'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.competition_catches cc
    WHERE cc.user_id = NEW.user_id
      AND cc.fish_id = NEW.fish_id
      AND cc.caught_at = NEW.created_at
      AND cc.qty = NEW.qty::integer
      AND cc.source = 'catch'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_golden_fisher_competition_catch ON public.golden_fisher_rewards;
CREATE TRIGGER trg_record_golden_fisher_competition_catch
AFTER UPDATE OF qty, fish_id ON public.golden_fisher_rewards
FOR EACH ROW
WHEN (
  NEW.qty > 0
  AND NEW.fish_id IS NOT NULL
  AND (OLD.qty <= 0 OR OLD.fish_id IS NULL)
)
EXECUTE FUNCTION public.record_golden_fisher_competition_catch();

WITH active_events AS (
  SELECT c.*
  FROM public.competitions c
  WHERE c.active = true
    AND c.metric IN ('fish_specific', 'fish_total')
    AND now() BETWEEN c.starts_at AND c.ends_at
), eligible_rewards AS (
  SELECT DISTINCT ON (gr.ship_id, gr.reward_slot, ev.id)
    gr.user_id,
    gr.fish_id,
    gr.created_at,
    gr.qty::integer AS qty
  FROM public.golden_fisher_rewards gr
  JOIN active_events ev
    ON gr.created_at BETWEEN ev.starts_at AND ev.ends_at
   AND (ev.metric = 'fish_total' OR ev.target_fish_id = gr.fish_id)
  WHERE gr.qty > 0
    AND gr.fish_id IS NOT NULL
  ORDER BY gr.ship_id, gr.reward_slot, ev.id
)
INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty, source)
SELECT er.user_id, er.fish_id, er.created_at, er.qty, 'catch'
FROM eligible_rewards er
WHERE NOT EXISTS (
  SELECT 1
  FROM public.competition_catches cc
  WHERE cc.user_id = er.user_id
    AND cc.fish_id = er.fish_id
    AND cc.caught_at = er.created_at
    AND cc.qty = er.qty
    AND cc.source = 'catch'
);

CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, score bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN RETURN; END IF;

  IF c.metric = 'explode_count' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, COUNT(*)::bigint
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND a.damage_dealt > 0 AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.source = 'catch'
      AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id
      AND cc.source = 'catch'
      AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_golden_fisher_competition_catch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_leaderboard(uuid) TO anon, authenticated, service_role;