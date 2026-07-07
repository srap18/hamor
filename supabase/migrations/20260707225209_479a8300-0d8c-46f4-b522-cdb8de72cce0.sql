
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS total_damage_dealt bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.trg_profile_add_damage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.damage_dealt IS NOT NULL AND NEW.damage_dealt > 0 THEN
    UPDATE public.profiles
    SET total_damage_dealt = COALESCE(total_damage_dealt, 0) + NEW.damage_dealt
    WHERE id = NEW.attacker_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_attack_add_profile_damage ON public.attacks;
CREATE TRIGGER t_attack_add_profile_damage
AFTER INSERT ON public.attacks
FOR EACH ROW EXECUTE FUNCTION public.trg_profile_add_damage();

UPDATE public.profiles p
SET total_damage_dealt = COALESCE(sub.total, 0)
FROM (
  SELECT attacker_id, SUM(GREATEST(damage_dealt, 0))::bigint AS total
  FROM public.attacks
  GROUP BY attacker_id
) sub
WHERE p.id = sub.attacker_id
  AND COALESCE(p.total_damage_dealt, 0) <> COALESCE(sub.total, 0);
