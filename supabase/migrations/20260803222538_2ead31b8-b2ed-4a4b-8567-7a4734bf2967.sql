ALTER TABLE public.redemption_codes
  ADD COLUMN IF NOT EXISTS min_market_level integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._block_low_level_redeem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_min integer;
  v_lvl integer;
BEGIN
  SELECT COALESCE(min_market_level, 0) INTO v_min
  FROM public.redemption_codes WHERE id = NEW.code_id;

  IF COALESCE(v_min, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(level, 1) INTO v_lvl
  FROM public.user_market WHERE user_id = NEW.user_id;

  IF COALESCE(v_lvl, 1) < v_min THEN
    RAISE EXCEPTION 'market_level_required_%', v_min;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_low_level_redeem ON public.code_redemptions;
CREATE TRIGGER trg_block_low_level_redeem
BEFORE INSERT ON public.code_redemptions
FOR EACH ROW EXECUTE FUNCTION public._block_low_level_redeem();