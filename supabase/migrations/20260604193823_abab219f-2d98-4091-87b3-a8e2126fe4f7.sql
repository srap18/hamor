CREATE OR REPLACE FUNCTION public.enforce_bg_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.selected_bg_id IN ('eiffel_night','crystal_kingdom') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory
       WHERE user_id = NEW.id
         AND item_type = 'background'
         AND item_id = NEW.selected_bg_id
    ) THEN
      NEW.selected_bg_id := 'celestial_colosseum';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bg_ownership ON public.profiles;
CREATE TRIGGER trg_enforce_bg_ownership
BEFORE INSERT OR UPDATE OF selected_bg_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_bg_ownership();