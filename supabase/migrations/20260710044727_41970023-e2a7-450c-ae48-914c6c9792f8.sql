
-- Fix tribes without an owner role in tribe_members.
-- Case A: tribes.owner_id is already a member — promote them to owner.
UPDATE public.tribe_members tm
SET role = 'owner'
FROM public.tribes t
WHERE tm.tribe_id = t.id
  AND tm.user_id = t.owner_id
  AND tm.role <> 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.tribe_members tm2
    WHERE tm2.tribe_id = t.id AND tm2.role = 'owner'
  );

-- Case B: tribes with members but no owner and owner_id is not a member —
-- promote highest-level member and align tribes.owner_id.
WITH candidates AS (
  SELECT DISTINCT ON (tm.tribe_id)
    tm.tribe_id, tm.user_id
  FROM public.tribe_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.tribe_id IN (
    SELECT t.id FROM public.tribes t
    LEFT JOIN public.tribe_members m ON m.tribe_id = t.id AND m.role = 'owner'
    WHERE m.tribe_id IS NULL
  )
  ORDER BY tm.tribe_id, COALESCE(p.level,0) DESC, COALESCE(p.xp,0) DESC, tm.joined_at ASC NULLS LAST
)
UPDATE public.tribe_members tm
SET role = 'owner'
FROM candidates c
WHERE tm.tribe_id = c.tribe_id AND tm.user_id = c.user_id;

UPDATE public.tribes t
SET owner_id = tm.user_id
FROM public.tribe_members tm
WHERE tm.tribe_id = t.id AND tm.role = 'owner' AND t.owner_id <> tm.user_id;

-- Safeguard trigger: ensure every tribe always has an owner in tribe_members.
CREATE OR REPLACE FUNCTION public.ensure_tribe_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_owner uuid;
BEGIN
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner')) THEN
    IF EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = OLD.tribe_id AND role = 'owner' AND user_id <> OLD.user_id) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    SELECT tm.user_id INTO new_owner
    FROM public.tribe_members tm
    LEFT JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.tribe_id = OLD.tribe_id AND tm.user_id <> OLD.user_id
    ORDER BY COALESCE(p.level,0) DESC, COALESCE(p.xp,0) DESC, tm.joined_at ASC NULLS LAST
    LIMIT 1;
    IF new_owner IS NOT NULL THEN
      UPDATE public.tribe_members SET role = 'owner' WHERE tribe_id = OLD.tribe_id AND user_id = new_owner;
      UPDATE public.tribes SET owner_id = new_owner WHERE id = OLD.tribe_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_tribe_owner ON public.tribe_members;
CREATE TRIGGER trg_ensure_tribe_owner
AFTER DELETE OR UPDATE OF role ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.ensure_tribe_owner();
