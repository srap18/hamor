-- Fix quest/achievement reward claiming and secure the internal award helper.

-- Remove the unsafe/wrong overload that used integer coins and could be called directly.
DROP FUNCTION IF EXISTS public.qa_award(uuid, integer, integer, integer);

-- Coins rewards are bigint in daily_quests/achievements and profiles.coins is bigint.
-- This helper is internal: claim_daily_quest/claim_achievement call it from SECURITY DEFINER context.
CREATE OR REPLACE FUNCTION public.qa_award(_uid uuid, _xp integer, _coins bigint, _gems integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET xp    = COALESCE(xp, 0)    + COALESCE(_xp, 0),
         coins = COALESCE(coins, 0) + COALESCE(_coins, 0),
         gems  = COALESCE(gems, 0)  + COALESCE(_gems, 0)
   WHERE id = _uid;
END;
$$;

-- Do not expose the internal award helper as a public RPC endpoint.
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM anon;
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.qa_award(uuid, integer, bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_daily_quest(_quest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _day text := public.qa_day_key();
  _q record;
  _p record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT * INTO _q
  FROM public.daily_quests
  WHERE id = _quest_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quest not found';
  END IF;

  SELECT * INTO _p
  FROM public.quest_progress
  WHERE user_id = _uid AND quest_id = _quest_id AND day_key = _day;

  IF NOT FOUND OR COALESCE(_p.progress, 0) < COALESCE(_q.goal_count, 1) THEN
    RAISE EXCEPTION 'not completed';
  END IF;

  IF COALESCE(_p.claimed, false) THEN
    RAISE EXCEPTION 'already claimed';
  END IF;

  UPDATE public.quest_progress
     SET claimed = true, updated_at = now()
   WHERE user_id = _uid AND quest_id = _quest_id AND day_key = _day;

  PERFORM public.qa_award(_uid, COALESCE(_q.reward_xp, 0), COALESCE(_q.reward_coins, 0)::bigint, COALESCE(_q.reward_gems, 0));

  RETURN jsonb_build_object(
    'xp', COALESCE(_q.reward_xp, 0),
    'coins', COALESCE(_q.reward_coins, 0),
    'gems', COALESCE(_q.reward_gems, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_achievement(_ach_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _a record;
  _u record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT * INTO _a
  FROM public.achievements
  WHERE id = _ach_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'achievement not found';
  END IF;

  IF _a.goal_type = 'level_reach' THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, progress, claimed)
    VALUES (_uid, _ach_id, COALESCE((SELECT level FROM public.profiles WHERE id = _uid), 1), false)
    ON CONFLICT (user_id, achievement_id) DO UPDATE
      SET progress = GREATEST(
        COALESCE(public.user_achievements.progress, 0),
        COALESCE((SELECT level FROM public.profiles WHERE id = _uid), 1)
      );
  END IF;

  SELECT * INTO _u
  FROM public.user_achievements
  WHERE user_id = _uid AND achievement_id = _ach_id;

  IF NOT FOUND OR COALESCE(_u.progress, 0) < COALESCE(_a.goal_count, 1) THEN
    RAISE EXCEPTION 'not completed';
  END IF;

  IF COALESCE(_u.claimed, false) THEN
    RAISE EXCEPTION 'already claimed';
  END IF;

  UPDATE public.user_achievements
     SET claimed = true, unlocked_at = now()
   WHERE user_id = _uid AND achievement_id = _ach_id;

  PERFORM public.qa_award(_uid, COALESCE(_a.reward_xp, 0), COALESCE(_a.reward_coins, 0)::bigint, COALESCE(_a.reward_gems, 0));

  RETURN jsonb_build_object(
    'xp', COALESCE(_a.reward_xp, 0),
    'coins', COALESCE(_a.reward_coins, 0),
    'gems', COALESCE(_a.reward_gems, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_daily_quest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_achievement(uuid) TO authenticated;