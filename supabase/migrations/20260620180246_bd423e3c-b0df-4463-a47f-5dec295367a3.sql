
-- 1) Table for tribe fishing events
CREATE TABLE public.tribe_fish_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  banner_emoji text NOT NULL DEFAULT '🎣',
  banner_theme text NOT NULL DEFAULT 'ocean',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  reward_gems integer NOT NULL DEFAULT 0,
  winner_tribe_id uuid REFERENCES public.tribes(id) ON DELETE SET NULL,
  prizes_distributed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tribe_fish_events TO anon, authenticated;
GRANT ALL ON public.tribe_fish_events TO service_role;

ALTER TABLE public.tribe_fish_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tfe_all_view" ON public.tribe_fish_events
  FOR SELECT USING (true);

CREATE POLICY "tfe_admin_manage" ON public.tribe_fish_events
  FOR ALL USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX tribe_fish_events_active_idx ON public.tribe_fish_events(active, ends_at);

-- 2) Leaderboard function
CREATE OR REPLACE FUNCTION public.tribe_fish_event_leaderboard(p_event_id uuid)
RETURNS TABLE(
  tribe_id uuid,
  tribe_name text,
  tribe_emblem text,
  tribe_banner text,
  members_count bigint,
  total_fish bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT starts_at, ends_at FROM public.tribe_fish_events WHERE id = p_event_id
  ),
  catches AS (
    SELECT p.tribe_id, SUM(cc.qty)::bigint AS total
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    CROSS JOIN ev
    WHERE p.tribe_id IS NOT NULL
      AND cc.caught_at >= ev.starts_at
      AND cc.caught_at <= ev.ends_at
    GROUP BY p.tribe_id
  )
  SELECT
    t.id,
    t.name,
    t.emblem,
    t.banner,
    (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
    COALESCE(c.total, 0)::bigint
  FROM public.tribes t
  LEFT JOIN catches c ON c.tribe_id = t.id
  WHERE COALESCE(c.total, 0) > 0
  ORDER BY COALESCE(c.total, 0) DESC, t.name ASC
$$;

GRANT EXECUTE ON FUNCTION public.tribe_fish_event_leaderboard(uuid) TO anon, authenticated;

-- 3) Distribute prize to winning tribe members (admin only)
CREATE OR REPLACE FUNCTION public.distribute_tribe_fish_event_prizes(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.tribe_fish_events;
  v_winner_id uuid;
  v_winner_total bigint;
  v_members_count integer;
  v_per_member integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_event FROM public.tribe_fish_events WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.prizes_distributed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_distributed';
  END IF;

  -- pick winning tribe
  SELECT tribe_id, total_fish INTO v_winner_id, v_winner_total
  FROM public.tribe_fish_event_leaderboard(p_event_id)
  LIMIT 1;

  IF v_winner_id IS NULL THEN
    UPDATE public.tribe_fish_events
       SET prizes_distributed_at = now(), active = false
     WHERE id = p_event_id;
    RETURN jsonb_build_object('ok', true, 'winner', null, 'reason', 'no_participants');
  END IF;

  SELECT COUNT(*) INTO v_members_count FROM public.tribe_members WHERE tribe_id = v_winner_id;
  IF v_members_count = 0 THEN
    v_per_member := 0;
  ELSE
    v_per_member := GREATEST(0, v_event.reward_gems / v_members_count);
  END IF;

  IF v_per_member > 0 THEN
    UPDATE public.profiles
       SET gems = gems + v_per_member
     WHERE id IN (SELECT user_id FROM public.tribe_members WHERE tribe_id = v_winner_id);
  END IF;

  UPDATE public.tribe_fish_events
     SET winner_tribe_id = v_winner_id,
         prizes_distributed_at = now(),
         active = false
   WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'winner_tribe_id', v_winner_id,
    'total_fish', v_winner_total,
    'members_count', v_members_count,
    'gems_per_member', v_per_member
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.distribute_tribe_fish_event_prizes(uuid) TO authenticated;
