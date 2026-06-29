
-- 1) Allow trusted SECURITY DEFINER RPCs to pass through protection triggers.
--    Detection: when this helper is called from within another PL/pgSQL
--    function (i.e. an RPC), the PG_CONTEXT stack contains more than just
--    the trigger frame + this helper frame. Direct client INSERT/UPDATE
--    statements have only those two frames.
CREATE OR REPLACE FUNCTION public.is_privileged_caller()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _ctx text;
  _frame_count int;
BEGIN
  -- Explicit opt-in flag (set by lucky box etc.)
  IF current_setting('app.server_write', true) = 'on' THEN
    RETURN true;
  END IF;

  -- Direct SQL / service role (no JWT)
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN true;
  END IF;

  -- If we're nested inside another PL/pgSQL function (an RPC), allow it.
  -- The call stack normally contains:
  --   frame 1: is_privileged_caller
  --   frame 2: protect_<table> trigger
  --   frame 3+: the RPC function the user invoked
  GET DIAGNOSTICS _ctx = PG_CONTEXT;
  _frame_count := COALESCE(
    (length(_ctx) - length(replace(_ctx, 'PL/pgSQL function ', ''))) /
    NULLIF(length('PL/pgSQL function '), 0),
    0
  );
  IF _frame_count >= 3 THEN
    RETURN true;
  END IF;

  -- Admins may write directly
  BEGIN
    RETURN public.is_admin(_uid);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$$;

-- 2) Anti-counter block bonus: stays at +0 until dragon level 50.
--    From level 50 onward, +1% per 5 levels (capped at +30).
CREATE OR REPLACE FUNCTION public.dragon_defense_bonus(_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.dragon_overall_level(_user_id) < 50 THEN 0
    ELSE LEAST(30, FLOOR((public.dragon_overall_level(_user_id) - 50) / 5.0)::int)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.dragon_defense_bonus(uuid) TO authenticated, anon;
