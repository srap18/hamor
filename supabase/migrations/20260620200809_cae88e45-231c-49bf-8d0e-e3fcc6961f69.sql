
-- 1) Tribe points column
ALTER TABLE public.tribes ADD COLUMN IF NOT EXISTS points bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tribes_points_idx ON public.tribes (points DESC);

-- 2) Prize tiers JSON on events: [{rank,gems,tribe_points}, ...]
ALTER TABLE public.tribe_fish_events
  ADD COLUMN IF NOT EXISTS prize_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS winner_tribe_points integer NOT NULL DEFAULT 0;

-- 3) Admin: adjust tribe points (delta can be negative)
CREATE OR REPLACE FUNCTION public.admin_adjust_tribe_points(p_tribe_id uuid, p_delta bigint, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.tribes
     SET points = GREATEST(0, points + p_delta)
   WHERE id = p_tribe_id
   RETURNING points INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'tribe_not_found'; END IF;
  INSERT INTO public.admin_audit(actor_id, action, target_id, details)
    VALUES (auth.uid(), 'tribe_points_adjust', p_tribe_id,
            jsonb_build_object('delta', p_delta, 'reason', p_reason, 'new_total', v_new));
  RETURN jsonb_build_object('ok', true, 'points', v_new);
END;
$$;

-- 4) Set tribe points directly (overwrite)
CREATE OR REPLACE FUNCTION public.admin_set_tribe_points(p_tribe_id uuid, p_value bigint, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_old bigint; v_new bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT points INTO v_old FROM public.tribes WHERE id = p_tribe_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'tribe_not_found'; END IF;
  v_new := GREATEST(0, p_value);
  UPDATE public.tribes SET points = v_new WHERE id = p_tribe_id;
  INSERT INTO public.admin_audit(actor_id, action, target_id, details)
    VALUES (auth.uid(), 'tribe_points_set', p_tribe_id,
            jsonb_build_object('old', v_old, 'new', v_new, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'points', v_new);
END;
$$;

-- 5) Global tribes ranking
CREATE OR REPLACE FUNCTION public.tribes_ranking(p_limit integer DEFAULT 100)
RETURNS TABLE(tribe_id uuid, tribe_name text, tribe_emblem text, tribe_banner text, members_count bigint, points bigint, level integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id, t.name, t.emblem, t.banner,
         (SELECT COUNT(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id)::bigint,
         t.points, t.level
  FROM public.tribes t
  ORDER BY t.points DESC, t.name ASC
  LIMIT GREATEST(1, p_limit)
$$;

-- 6) Multi-tier prize distribution
CREATE OR REPLACE FUNCTION public.distribute_tribe_fish_event_prizes(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event public.tribe_fish_events;
  v_tiers jsonb;
  v_tier jsonb;
  v_rank integer;
  v_gems integer;
  v_tpoints integer;
  v_per_member integer;
  v_members_count integer;
  v_tribe_id uuid;
  v_total bigint;
  v_winner_id uuid;
  v_winner_total bigint;
  v_results jsonb := '[]'::jsonb;
  v_lb_row record;
  v_idx integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_event FROM public.tribe_fish_events WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.prizes_distributed_at IS NOT NULL THEN RAISE EXCEPTION 'already_distributed'; END IF;

  -- Build tiers: use prize_tiers if not empty, otherwise fallback to legacy single-winner reward_gems
  v_tiers := COALESCE(v_event.prize_tiers, '[]'::jsonb);
  IF jsonb_array_length(v_tiers) = 0 THEN
    v_tiers := jsonb_build_array(jsonb_build_object(
      'rank', 1,
      'gems', COALESCE(v_event.reward_gems, 0),
      'tribe_points', COALESCE(v_event.winner_tribe_points, 0)
    ));
  END IF;

  -- Walk leaderboard ranks; for each tier, find Nth tribe and grant
  FOR v_lb_row IN
    SELECT tribe_id, total_fish FROM public.tribe_fish_event_leaderboard(p_event_id)
  LOOP
    v_idx := v_idx + 1;
    -- find matching tier by rank
    SELECT t INTO v_tier
      FROM jsonb_array_elements(v_tiers) AS t
     WHERE COALESCE((t->>'rank')::int, 0) = v_idx
     LIMIT 1;
    IF v_tier IS NULL THEN
      CONTINUE; -- no prize for this rank
    END IF;
    v_tribe_id := v_lb_row.tribe_id;
    v_total := v_lb_row.total_fish;
    v_gems := GREATEST(0, COALESCE((v_tier->>'gems')::int, 0));
    v_tpoints := GREATEST(0, COALESCE((v_tier->>'tribe_points')::int, 0));

    SELECT COUNT(*) INTO v_members_count FROM public.tribe_members WHERE tribe_id = v_tribe_id;
    v_per_member := CASE WHEN v_members_count > 0 THEN v_gems / v_members_count ELSE 0 END;

    IF v_per_member > 0 THEN
      UPDATE public.profiles
         SET gems = gems + v_per_member
       WHERE id IN (SELECT user_id FROM public.tribe_members WHERE tribe_id = v_tribe_id);
    END IF;
    IF v_tpoints > 0 THEN
      UPDATE public.tribes SET points = points + v_tpoints WHERE id = v_tribe_id;
    END IF;

    IF v_idx = 1 THEN
      v_winner_id := v_tribe_id;
      v_winner_total := v_total;
    END IF;

    v_results := v_results || jsonb_build_object(
      'rank', v_idx,
      'tribe_id', v_tribe_id,
      'total_fish', v_total,
      'members_count', v_members_count,
      'gems_total', v_gems,
      'gems_per_member', v_per_member,
      'tribe_points', v_tpoints
    );
  END LOOP;

  UPDATE public.tribe_fish_events
     SET winner_tribe_id = v_winner_id,
         prizes_distributed_at = now(),
         active = false
   WHERE id = p_event_id;

  IF v_winner_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'no_participants', 'results', v_results);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'winner_tribe_id', v_winner_id,
    'total_fish', v_winner_total,
    'results', v_results
  );
END;
$$;
