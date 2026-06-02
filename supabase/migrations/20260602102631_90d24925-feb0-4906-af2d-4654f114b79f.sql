
CREATE OR REPLACE FUNCTION public._auto_route_new_ship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _active_count int;
  _storage_count int;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = NEW.user_id;

  IF NEW.in_storage = false AND _active_count >= 3 THEN
    IF _storage_count >= 3 THEN
      RAISE EXCEPTION 'fleet and storage full';
    END IF;
    NEW.in_storage := true;
  ELSIF NEW.in_storage = true AND _storage_count >= 3 THEN
    RAISE EXCEPTION 'storage full';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ships_auto_route ON public.ships_owned;
CREATE TRIGGER trg_ships_auto_route
  BEFORE INSERT ON public.ships_owned
  FOR EACH ROW
  EXECUTE FUNCTION public._auto_route_new_ship();
