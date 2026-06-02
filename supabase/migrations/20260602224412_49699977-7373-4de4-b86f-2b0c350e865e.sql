
CREATE OR REPLACE FUNCTION public.mirror_last_destroyer_to_global()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.last_destroyer_at IS NOT NULL
     AND NEW.last_destroyer_name IS NOT NULL
     AND NEW.last_destroyer_kind IN ('nuke','ad_bomb')
     AND NEW.last_destroyer_at IS DISTINCT FROM OLD.last_destroyer_at THEN
    INSERT INTO public.global_last_attack(id, attacker_id, attacker_name, target_id, target_name, kind, at)
    VALUES (true, NEW.last_destroyer_id, NEW.last_destroyer_name, NEW.id, NEW.display_name, NEW.last_destroyer_kind, NEW.last_destroyer_at)
    ON CONFLICT (id) DO UPDATE
      SET attacker_id = EXCLUDED.attacker_id,
          attacker_name = EXCLUDED.attacker_name,
          target_id = EXCLUDED.target_id,
          target_name = EXCLUDED.target_name,
          kind = EXCLUDED.kind,
          at = EXCLUDED.at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_last_destroyer_to_global ON public.profiles;
CREATE TRIGGER trg_mirror_last_destroyer_to_global
AFTER UPDATE OF last_destroyer_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.mirror_last_destroyer_to_global();

-- Backfill from current ad_bomb victim
INSERT INTO public.global_last_attack(id, attacker_id, attacker_name, target_id, target_name, kind, at)
SELECT true, p.last_destroyer_id, p.last_destroyer_name, p.id, p.display_name, p.last_destroyer_kind, p.last_destroyer_at
FROM public.profiles p
WHERE p.last_destroyer_at IS NOT NULL
  AND p.last_destroyer_kind IN ('nuke','ad_bomb')
ORDER BY p.last_destroyer_at DESC
LIMIT 1
ON CONFLICT (id) DO UPDATE
  SET attacker_id = EXCLUDED.attacker_id,
      attacker_name = EXCLUDED.attacker_name,
      target_id = EXCLUDED.target_id,
      target_name = EXCLUDED.target_name,
      kind = EXCLUDED.kind,
      at = EXCLUDED.at;
