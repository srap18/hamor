
-- Recompute tribes.total_donations from sum of tribe_members.donation_coins (authoritative running counter)
UPDATE public.tribes t
SET total_donations = COALESCE(s.total, 0)
FROM (
  SELECT tribe_id, SUM(donation_coins)::bigint AS total
  FROM public.tribe_members
  GROUP BY tribe_id
) s
WHERE s.tribe_id = t.id;

-- Keep it in sync going forward via trigger on tribe_members
CREATE OR REPLACE FUNCTION public.sync_tribe_total_donations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _tid := OLD.tribe_id;
  ELSE
    _tid := NEW.tribe_id;
  END IF;

  UPDATE public.tribes
    SET total_donations = COALESCE((
      SELECT SUM(donation_coins)::bigint FROM public.tribe_members WHERE tribe_id = _tid
    ), 0)
    WHERE id = _tid;

  -- Also sync the OLD tribe if a member moved between tribes
  IF TG_OP = 'UPDATE' AND OLD.tribe_id IS DISTINCT FROM NEW.tribe_id THEN
    UPDATE public.tribes
      SET total_donations = COALESCE((
        SELECT SUM(donation_coins)::bigint FROM public.tribe_members WHERE tribe_id = OLD.tribe_id
      ), 0)
      WHERE id = OLD.tribe_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tribe_total_donations ON public.tribe_members;
CREATE TRIGGER trg_sync_tribe_total_donations
AFTER INSERT OR UPDATE OF donation_coins OR DELETE ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.sync_tribe_total_donations();
