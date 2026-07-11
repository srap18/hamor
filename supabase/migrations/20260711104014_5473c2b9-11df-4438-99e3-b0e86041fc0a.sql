-- Keep tribe donations even when a member leaves.
-- Source total_donations from historical tribe_donations table, not from current members.

CREATE OR REPLACE FUNCTION public.sync_tribe_total_donations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _tid := OLD.tribe_id;
  ELSE
    _tid := NEW.tribe_id;
  END IF;

  IF _tid IS NOT NULL THEN
    UPDATE public.tribes
      SET total_donations = COALESCE((
        SELECT SUM(amount)::bigint FROM public.tribe_donations WHERE tribe_id = _tid
      ), 0)
      WHERE id = _tid;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.tribe_id IS DISTINCT FROM NEW.tribe_id AND OLD.tribe_id IS NOT NULL THEN
    UPDATE public.tribes
      SET total_donations = COALESCE((
        SELECT SUM(amount)::bigint FROM public.tribe_donations WHERE tribe_id = OLD.tribe_id
      ), 0)
      WHERE id = OLD.tribe_id;
  END IF;

  RETURN NULL;
END;
$function$;

-- Full re-sync of every tribe using historical donations (this restores
-- totals for anyone who left in the past week — or any time — and hasn't returned).
UPDATE public.tribes t
SET total_donations = COALESCE(d.s, 0)
FROM (
  SELECT tribe_id, SUM(amount)::bigint AS s
  FROM public.tribe_donations
  GROUP BY tribe_id
) d
WHERE d.tribe_id = t.id;

UPDATE public.tribes
SET total_donations = 0
WHERE id NOT IN (SELECT DISTINCT tribe_id FROM public.tribe_donations WHERE tribe_id IS NOT NULL)
  AND COALESCE(total_donations,0) <> 0;