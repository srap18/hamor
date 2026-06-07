
CREATE OR REPLACE FUNCTION public.purge_member_support_on_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _amt bigint := COALESCE(OLD.donation_coins, 0);
BEGIN
  -- Remove the leaving member's donation history for this tribe
  DELETE FROM public.tribe_donations
   WHERE tribe_id = OLD.tribe_id AND user_id = OLD.user_id;

  -- Subtract their contribution from the tribe's total donations counter
  IF _amt > 0 THEN
    UPDATE public.tribes
       SET total_donations = GREATEST(0, COALESCE(total_donations, 0) - _amt)
     WHERE id = OLD.tribe_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_purge_member_support_on_leave ON public.tribe_members;
CREATE TRIGGER trg_purge_member_support_on_leave
BEFORE DELETE ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.purge_member_support_on_leave();
