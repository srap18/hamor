
-- Add burned background timestamp to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bg_burned_until timestamptz;

-- Burn a target's background for 7 days. Caller must have attacked target in the last 5 minutes.
CREATE OR REPLACE FUNCTION public.burn_target_bg(_target_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _recent_attack_count int;
  _until timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;

  SELECT COUNT(*) INTO _recent_attack_count
    FROM public.attacks
   WHERE attacker_id = _attacker
     AND defender_id = _target_id
     AND created_at > now() - interval '5 minutes';
  IF _recent_attack_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;

  _until := now() + interval '7 days';
  UPDATE public.profiles
     SET bg_burned_until = GREATEST(coalesce(bg_burned_until, now()), _until)
   WHERE id = _target_id;

  RETURN _until;
END;
$$;

GRANT EXECUTE ON FUNCTION public.burn_target_bg(uuid) TO authenticated;

-- Repair caller's burned background for 100 gems
CREATE OR REPLACE FUNCTION public.repair_burned_bg()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _gems int;
  _burned timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT gems, bg_burned_until INTO _gems, _burned FROM public.profiles WHERE id = _uid;
  IF _burned IS NULL OR _burned <= now() THEN RAISE EXCEPTION 'background is not burned'; END IF;
  IF _gems < 100 THEN RAISE EXCEPTION 'not enough gems'; END IF;

  UPDATE public.profiles
     SET gems = gems - 100,
         bg_burned_until = NULL
   WHERE id = _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_burned_bg() TO authenticated;
