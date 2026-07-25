
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tutorial_completed boolean NOT NULL DEFAULT false;

-- Existing players: mark done so they never see the tutorial.
UPDATE public.profiles SET tutorial_completed = true WHERE created_at < now();

CREATE OR REPLACE FUNCTION public.complete_tutorial()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET tutorial_completed = true WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_tutorial() TO authenticated;
