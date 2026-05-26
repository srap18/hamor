-- Enforce a minimum of 1 ship per player at the database level.
CREATE OR REPLACE FUNCTION public.prevent_last_ship_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _remaining int;
BEGIN
  SELECT COUNT(*) INTO _remaining
    FROM public.ships_owned
    WHERE user_id = OLD.user_id AND id <> OLD.id;
  IF _remaining < 1 THEN
    RAISE EXCEPTION 'cannot sell last ship: every captain must own at least 1 ship';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_ship_delete ON public.ships_owned;
CREATE TRIGGER trg_prevent_last_ship_delete
BEFORE DELETE ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_ship_delete();