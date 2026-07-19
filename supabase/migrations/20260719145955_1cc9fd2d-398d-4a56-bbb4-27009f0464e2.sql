
-- Admin RPC to adjust arena weekly score
CREATE OR REPLACE FUNCTION public.admin_adjust_arena_score(_user_id uuid, _delta bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _week date;
  _new bigint;
  _is_admin boolean;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'moderator'::app_role)
    INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;

  _week := (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date);

  INSERT INTO public.arena_scores (user_id, week_start, score, wins, updated_at)
  VALUES (_user_id, _week, GREATEST(0, _delta), 0, now())
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET score = GREATEST(0, public.arena_scores.score + _delta),
        updated_at = now()
  RETURNING score INTO _new;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'arena_score_adjust', _user_id,
          jsonb_build_object('delta', _delta, 'week_start', _week, 'new_score', _new));

  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_arena_score(uuid, bigint) TO authenticated;

-- Enable realtime for arena_scores
ALTER TABLE public.arena_scores REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_scores;
