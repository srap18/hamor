CREATE OR REPLACE FUNCTION public.qa_award(_uid uuid, _xp integer, _coins integer, _gems integer)
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
END $$;

GRANT EXECUTE ON FUNCTION public.qa_award(uuid, integer, integer, integer) TO authenticated, service_role;