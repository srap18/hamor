
-- Recreate qa_award as an INTERNAL helper used only by claim_daily_quest / claim_achievement.
-- Direct call by clients is BLOCKED (REVOKE EXECUTE from public/anon/authenticated).
-- The two claim_* SECURITY DEFINER functions run as the function owner, so they can still PERFORM this.

CREATE OR REPLACE FUNCTION public.qa_award(_user uuid, _xp integer, _coins bigint, _gems integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user IS NULL THEN
    RAISE EXCEPTION 'qa_award: user required';
  END IF;
  PERFORM public._mutate_currency(_user, COALESCE(_coins,0)::bigint, COALESCE(_gems,0)::int, 0, COALESCE(_xp,0)::int);
END;
$$;

-- Lock it down: only the owner (and SECURITY DEFINER callers) may execute.
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM anon;
REVOKE ALL ON FUNCTION public.qa_award(uuid, integer, bigint, integer) FROM authenticated;
