
-- Trigger: prevent non-admins from changing sensitive profile columns
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean := false;
BEGIN
  -- Service role / superuser bypass (no JWT context)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    _is_admin := public.is_admin(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    _is_admin := false;
  END;

  IF _is_admin THEN
    RETURN NEW;
  END IF;

  -- Block changes to protected columns by regular users
  IF NEW.elite_vip_level    IS DISTINCT FROM OLD.elite_vip_level    THEN NEW.elite_vip_level    := OLD.elite_vip_level;    END IF;
  IF NEW.elite_vip_expires_at IS DISTINCT FROM OLD.elite_vip_expires_at THEN NEW.elite_vip_expires_at := OLD.elite_vip_expires_at; END IF;
  IF NEW.coins  IS DISTINCT FROM OLD.coins  THEN NEW.coins  := OLD.coins;  END IF;
  IF NEW.gems   IS DISTINCT FROM OLD.gems   THEN NEW.gems   := OLD.gems;   END IF;
  IF NEW.xp     IS DISTINCT FROM OLD.xp     THEN NEW.xp     := OLD.xp;     END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- Revoke the stolen VIP from r3b_r
UPDATE public.profiles
SET elite_vip_level = 0, elite_vip_expires_at = NULL
WHERE id = 'fe2a7296-6ba8-408d-9a6e-bc1baa2e3f1b';
