CREATE OR REPLACE FUNCTION public._block_muted_redeem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- only block self-service redemptions (admin grants run without auth.uid() = target)
  IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() AND public.is_muted(NEW.user_id) THEN
    RAISE EXCEPTION 'user_muted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_muted_redeem ON public.code_redemptions;
CREATE TRIGGER block_muted_redeem
BEFORE INSERT ON public.code_redemptions
FOR EACH ROW EXECUTE FUNCTION public._block_muted_redeem();