
CREATE OR REPLACE FUNCTION public.tribe_level_from_donations(_d bigint)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _d >= 3000000 THEN 10
    WHEN _d >= 2300000 THEN 9
    WHEN _d >= 1700000 THEN 8
    WHEN _d >= 1200000 THEN 7
    WHEN _d >= 800000  THEN 6
    WHEN _d >= 500000  THEN 5
    WHEN _d >= 300000  THEN 4
    WHEN _d >= 150000  THEN 3
    WHEN _d >= 50000   THEN 2
    ELSE 1
  END
$$;

CREATE OR REPLACE FUNCTION public.sync_tribe_level()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.level := public.tribe_level_from_donations(NEW.total_donations);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tribe_level ON public.tribes;
CREATE TRIGGER trg_sync_tribe_level
BEFORE INSERT OR UPDATE OF total_donations ON public.tribes
FOR EACH ROW EXECUTE FUNCTION public.sync_tribe_level();

UPDATE public.tribes
SET level = public.tribe_level_from_donations(total_donations);
