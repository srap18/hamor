
-- 1) Revoke client access to award_arena_score — clients can no longer push arbitrary scores.
REVOKE EXECUTE ON FUNCTION public.award_arena_score(bigint, boolean) FROM authenticated, anon, PUBLIC;

-- 2) Add a hard server-side cap inside the function itself, in case any internal caller
--    ever passes a huge value. Per-call cap = 5,000 points.
CREATE OR REPLACE FUNCTION public.award_arena_score(p_score bigint, p_won boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
  v_capped bigint;
BEGIN
  IF v_user IS NULL OR p_score <= 0 THEN RETURN; END IF;
  -- Hard cap per call: prevents inflated scores even from internal callers.
  v_capped := LEAST(p_score, 5000);
  INSERT INTO arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (v_user, v_week, v_capped, CASE WHEN p_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    score = arena_scores.score + EXCLUDED.score,
    wins = arena_scores.wins + EXCLUDED.wins,
    updated_at = now();
END $function$;

-- 3) Clear all current arena scores (they were earned via the exploited path).
DELETE FROM public.arena_scores;
