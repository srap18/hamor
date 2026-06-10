
-- 1) Stop wiping donations on leave: replace the purge trigger with a no-op-style behavior.
DROP TRIGGER IF EXISTS trg_purge_member_support_on_leave ON public.tribe_members;

-- Keep the function around (other code might reference it), but make it a safe no-op.
CREATE OR REPLACE FUNCTION public.purge_member_support_on_leave()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Intentionally does nothing now: donations remain with the tribe
  -- when a member leaves, and are restored on rejoin.
  RETURN OLD;
END;
$function$;

-- 2) Restore a returning member's donation_coins from their historical donations.
CREATE OR REPLACE FUNCTION public.restore_member_donations_on_join()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sum bigint;
  _last timestamptz;
BEGIN
  SELECT COALESCE(SUM(amount), 0), MAX(created_at)
    INTO _sum, _last
    FROM public.tribe_donations
   WHERE tribe_id = NEW.tribe_id AND user_id = NEW.user_id;

  IF _sum > 0 THEN
    NEW.donation_coins := _sum;
    NEW.last_donation_at := COALESCE(NEW.last_donation_at, _last);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_restore_member_donations_on_join ON public.tribe_members;
CREATE TRIGGER trg_restore_member_donations_on_join
BEFORE INSERT ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.restore_member_donations_on_join();
