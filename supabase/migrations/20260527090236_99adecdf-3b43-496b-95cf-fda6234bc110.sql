ALTER TABLE public.fish_caught ADD COLUMN IF NOT EXISTS total_caught integer NOT NULL DEFAULT 0;

UPDATE public.fish_caught SET total_caught = GREATEST(total_caught, quantity);

CREATE OR REPLACE FUNCTION public.increment_fish_caught(_fish_id text, _qty integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _fish_id, _qty, _qty)
  ON CONFLICT (user_id, fish_id) DO UPDATE
  SET quantity = public.fish_caught.quantity + _qty,
      total_caught = public.fish_caught.total_caught + _qty,
      updated_at = now();
END $$;

GRANT EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) TO authenticated;