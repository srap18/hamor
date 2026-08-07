-- 1) Future: golden fisher catches are logged with a distinct source so leaderboards ignore them.
CREATE OR REPLACE FUNCTION public.record_golden_fisher_competition_catch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _event public.competitions%ROWTYPE;
BEGIN
  IF COALESCE(NEW.qty, 0) <= 0 OR NEW.fish_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.* INTO _event
  FROM public.competitions c
  WHERE c.active = true
    AND c.metric IN ('fish_specific', 'fish_total')
    AND NEW.created_at BETWEEN c.starts_at AND c.ends_at
    AND (c.metric = 'fish_total' OR c.target_fish_id = NEW.fish_id)
  ORDER BY c.starts_at DESC
  LIMIT 1;

  IF _event.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- source = 'golden_fisher' → excluded from every competition leaderboard.
  INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty, source)
  VALUES (NEW.user_id, NEW.fish_id, NEW.created_at, NEW.qty::integer, 'golden_fisher');

  RETURN NEW;
END;
$function$;

-- 2) Retroactive: reclassify already-logged golden fisher catches.
UPDATE public.competition_catches cc
   SET source = 'golden_fisher'
 WHERE cc.source = 'catch'
   AND EXISTS (
     SELECT 1 FROM public.golden_fisher_rewards g
      WHERE g.user_id = cc.user_id
        AND g.fish_id = cc.fish_id
        AND g.created_at = cc.caught_at
        AND g.qty = cc.qty
   );