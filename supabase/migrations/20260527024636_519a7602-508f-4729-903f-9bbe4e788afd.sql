ALTER TABLE public.player_daughter ADD COLUMN IF NOT EXISTS outfit text NOT NULL DEFAULT 'sailor';

CREATE OR REPLACE FUNCTION public.set_daughter_outfit(_outfit text)
RETURNS public.player_daughter
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.player_daughter;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _outfit NOT IN ('sailor','summer','captain','beach') THEN
    RAISE EXCEPTION 'invalid outfit';
  END IF;
  UPDATE public.player_daughter
     SET outfit = _outfit, updated_at = now()
   WHERE user_id = auth.uid()
  RETURNING * INTO _row;
  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_daughter_outfit(text) TO authenticated;