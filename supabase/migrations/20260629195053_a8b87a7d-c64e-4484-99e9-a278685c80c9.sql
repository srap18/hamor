
-- Backfill empty/missing stats for all dragon_equipment items by rarity,
-- so legacy rows (especially fatak granted via codes/admin) deal the right damage.

CREATE OR REPLACE FUNCTION public._dragon_equipment_default_stats(_rarity text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _rarity
    WHEN 'common'    THEN jsonb_build_object('attack_pct', 5,  'crit', 0)
    WHEN 'rare'      THEN jsonb_build_object('attack_pct', 15, 'crit', 5)
    WHEN 'epic'      THEN jsonb_build_object('attack_pct', 25, 'crit', 10)
    WHEN 'legendary' THEN jsonb_build_object('attack_pct', 35, 'crit', 15, 'free_strike', true)
    WHEN 'divine'    THEN jsonb_build_object('attack_pct', 50, 'crit', 20, 'free_strike', true, 'continuous', true)
    WHEN 'fatak'     THEN jsonb_build_object('attack_pct', 75, 'crit', 30, 'free_strike', true, 'continuous', true, 'deadly', true)
    ELSE jsonb_build_object('attack_pct', 5, 'crit', 0)
  END;
$$;

-- Backfill rows where stats is NULL, '{}', or missing attack_pct
UPDATE public.dragon_equipment de
   SET stats = public._dragon_equipment_default_stats(de.rarity)
 WHERE de.stats IS NULL
    OR de.stats = '{}'::jsonb
    OR (de.stats->>'attack_pct') IS NULL
    OR COALESCE((de.stats->>'attack_pct')::int, 0)
        < COALESCE((public._dragon_equipment_default_stats(de.rarity)->>'attack_pct')::int, 0);

-- Trigger: when a row is inserted/updated with empty stats, auto-fill from rarity
CREATE OR REPLACE FUNCTION public._dragon_equipment_fill_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stats IS NULL
     OR NEW.stats = '{}'::jsonb
     OR (NEW.stats->>'attack_pct') IS NULL THEN
    NEW.stats := public._dragon_equipment_default_stats(NEW.rarity);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dragon_equipment_fill_stats ON public.dragon_equipment;
CREATE TRIGGER trg_dragon_equipment_fill_stats
BEFORE INSERT OR UPDATE OF rarity, stats ON public.dragon_equipment
FOR EACH ROW EXECUTE FUNCTION public._dragon_equipment_fill_stats();
