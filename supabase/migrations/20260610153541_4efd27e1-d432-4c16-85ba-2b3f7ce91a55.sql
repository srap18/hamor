CREATE OR REPLACE FUNCTION public.purge_member_support_on_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _amt bigint := COALESCE(OLD.donation_coins, 0);
BEGIN
  IF _amt > 0 THEN
    UPDATE public.tribes
       SET total_donations = GREATEST(0, COALESCE(total_donations, 0) - _amt),
           treasure_coins = GREATEST(0, COALESCE(treasure_coins, 0) - _amt)
     WHERE id = OLD.tribe_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_purge_member_support_on_leave ON public.tribe_members;
CREATE TRIGGER trg_purge_member_support_on_leave
BEFORE DELETE ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.purge_member_support_on_leave();

CREATE OR REPLACE FUNCTION public.restore_member_donations_on_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sum bigint;
  _last timestamptz;
BEGIN
  SELECT COALESCE(SUM(amount), 0), MAX(created_at)
    INTO _sum, _last
    FROM public.tribe_donations
   WHERE tribe_id = NEW.tribe_id AND user_id = NEW.user_id;

  IF _sum > 0 THEN
    UPDATE public.tribe_members
       SET donation_coins = _sum,
           last_donation_at = COALESCE(last_donation_at, _last)
     WHERE tribe_id = NEW.tribe_id AND user_id = NEW.user_id;

    UPDATE public.tribes
       SET total_donations = COALESCE(total_donations, 0) + _sum,
           treasure_coins = COALESCE(treasure_coins, 0) + _sum
     WHERE id = NEW.tribe_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restore_member_donations_on_join ON public.tribe_members;
CREATE TRIGGER trg_restore_member_donations_on_join
AFTER INSERT ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.restore_member_donations_on_join();