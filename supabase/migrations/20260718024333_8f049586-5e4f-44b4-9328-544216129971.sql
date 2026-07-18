
-- 1) Backfill: any dragon whose pearl_level exceeds its DP-derived level
--    gets refunded the pearls it "spent" past that level, and pearl_level
--    is capped down to the DP-derived level. (Currently 0 rows affected.)
DO $$
DECLARE
  r record;
  lvl int;
  cost int;
  refund int;
  dp_lvl int;
BEGIN
  FOR r IN
    SELECT user_id, stage, dp, pearls, pearl_level
    FROM public.dragons
    WHERE COALESCE(pearl_level,0) > public.compute_dragon_overall_level(stage, dp)
  LOOP
    dp_lvl := public.compute_dragon_overall_level(r.stage, r.dp);
    refund := 0;
    lvl := dp_lvl;
    WHILE lvl < r.pearl_level LOOP
      cost := public.dragon_pearl_upgrade_cost(lvl);
      IF cost IS NOT NULL THEN refund := refund + cost; END IF;
      lvl := lvl + 1;
    END LOOP;
    UPDATE public.dragons
       SET pearl_level = dp_lvl,
           pearls = COALESCE(pearls,0) + refund,
           updated_at = now()
     WHERE user_id = r.user_id;
  END LOOP;
END $$;

-- 2) Enforce going forward: pearl_level can never exceed DP-derived level.
CREATE OR REPLACE FUNCTION public.trg_cap_pearl_level_to_dp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  dp_lvl int;
BEGIN
  dp_lvl := public.compute_dragon_overall_level(NEW.stage, NEW.dp);
  IF COALESCE(NEW.pearl_level,0) > dp_lvl THEN
    NEW.pearl_level := dp_lvl;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cap_pearl_level_to_dp ON public.dragons;
CREATE TRIGGER cap_pearl_level_to_dp
BEFORE INSERT OR UPDATE OF stage, dp, pearl_level
ON public.dragons
FOR EACH ROW
EXECUTE FUNCTION public.trg_cap_pearl_level_to_dp();
