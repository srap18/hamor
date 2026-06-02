-- One-time cleanup of empty tribes
DELETE FROM public.tribes t
WHERE NOT EXISTS (SELECT 1 FROM public.tribe_members tm WHERE tm.tribe_id = t.id);

-- Auto-delete empty tribes whenever the last member leaves
CREATE OR REPLACE FUNCTION public.delete_tribe_if_empty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = OLD.tribe_id) THEN
    DELETE FROM public.tribes WHERE id = OLD.tribe_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_tribe_if_empty ON public.tribe_members;
CREATE TRIGGER trg_delete_tribe_if_empty
AFTER DELETE ON public.tribe_members
FOR EACH ROW
EXECUTE FUNCTION public.delete_tribe_if_empty();