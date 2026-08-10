CREATE OR REPLACE FUNCTION public.sync_elite_vip6_golden_fisher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.elite_vip_level, 0) >= 6
     AND (NEW.elite_vip_expires_at IS NULL OR NEW.elite_vip_expires_at > now()) THEN
    NEW.golden_fisher_until := GREATEST(
      COALESCE(NEW.golden_fisher_until, '-infinity'::timestamptz),
      COALESCE(NEW.elite_vip_expires_at, 'infinity'::timestamptz)
    );
  ELSIF COALESCE(OLD.elite_vip_level, 0) >= 6
        AND COALESCE(NEW.elite_vip_level, 0) < 6
        AND (OLD.elite_vip_expires_at IS NULL OR NEW.golden_fisher_until = OLD.elite_vip_expires_at) THEN
    NEW.golden_fisher_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_elite_vip6_golden_fisher ON public.profiles;
CREATE TRIGGER trg_sync_elite_vip6_golden_fisher
BEFORE INSERT OR UPDATE OF elite_vip_level, elite_vip_expires_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_elite_vip6_golden_fisher();

REVOKE ALL ON FUNCTION public.sync_elite_vip6_golden_fisher() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_elite_vip6_golden_fisher() TO service_role;