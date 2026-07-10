
CREATE OR REPLACE FUNCTION public._award_nuke_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'nuke' AND NEW.attacker_id IS NOT NULL THEN
    PERFORM public.add_xp(NEW.attacker_id, 250);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_nuke_xp ON public.global_banners;
CREATE TRIGGER trg_award_nuke_xp AFTER INSERT ON public.global_banners
FOR EACH ROW EXECUTE FUNCTION public._award_nuke_xp();

CREATE OR REPLACE FUNCTION public._award_ad_bomb_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.attacker_id IS NOT NULL THEN
    PERFORM public.add_xp(NEW.attacker_id, 200);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_ad_bomb_xp ON public.ad_bombs;
CREATE TRIGGER trg_award_ad_bomb_xp AFTER INSERT ON public.ad_bombs
FOR EACH ROW EXECUTE FUNCTION public._award_ad_bomb_xp();
