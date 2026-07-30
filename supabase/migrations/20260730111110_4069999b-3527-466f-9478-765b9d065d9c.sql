-- 1) Fix: remove the faulty duplicate-guard that collapsed multiple identical
-- golden-fisher catches (same user/fish/qty in the same tick, one row per ship)
-- into a single competition catch. Each golden_fisher_rewards row fires this
-- trigger exactly once (WHEN old.qty <= 0 AND new.qty > 0), so no guard is needed.
CREATE OR REPLACE FUNCTION public.record_golden_fisher_competition_catch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty, source)
  VALUES (NEW.user_id, NEW.fish_id, NEW.created_at, NEW.qty::integer, 'catch');

  RETURN NEW;
END;
$$;

-- 2) Compensation for the currently running fishing competition:
-- for every real stock insert (audit log) that has no matching competition row,
-- add the missing rows with the exact same fish/qty/time.
WITH win AS (
  SELECT starts_at, ends_at FROM public.competitions
  WHERE id = 'c41f5e61-2a6d-4dfc-93e2-987364f60d14'
),
a AS (
  SELECT fa.user_id, fa.fish_id, fa.changed_at AS t, fa.qty_delta AS qty, count(*) AS n
  FROM public.fish_stock_audit fa, win w
  WHERE fa.op = 'insert' AND fa.changed_at BETWEEN w.starts_at AND w.ends_at
  GROUP BY 1,2,3,4
),
b AS (
  SELECT cc.user_id, cc.fish_id, cc.caught_at AS t, cc.qty, count(*) AS m
  FROM public.competition_catches cc, win w
  WHERE cc.source = 'catch' AND cc.caught_at BETWEEN w.starts_at AND w.ends_at
  GROUP BY 1,2,3,4
),
d AS (
  SELECT a.user_id, a.fish_id, a.t, a.qty, a.n - COALESCE(b.m, 0) AS missing
  FROM a LEFT JOIN b
    ON b.user_id = a.user_id AND b.fish_id = a.fish_id AND b.t = a.t AND b.qty = a.qty
  WHERE a.n - COALESCE(b.m, 0) > 0
)
INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty, source)
SELECT d.user_id, d.fish_id, d.t, d.qty::integer, 'catch'
FROM d, generate_series(1, d.missing);
