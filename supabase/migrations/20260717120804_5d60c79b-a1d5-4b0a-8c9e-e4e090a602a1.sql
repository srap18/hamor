CREATE OR REPLACE FUNCTION public._award_attack_xp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _gain integer;
BEGIN
  IF NEW.attacker_id IS NULL OR COALESCE(NEW.damage_dealt, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  _gain := LEAST(200, GREATEST(5, (NEW.damage_dealt / 2000)::int));
  PERFORM public.add_xp(NEW.attacker_id, _gain);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_attack_xp ON public.attacks;
CREATE TRIGGER trg_award_attack_xp
  AFTER INSERT ON public.attacks
  FOR EACH ROW EXECUTE FUNCTION public._award_attack_xp();