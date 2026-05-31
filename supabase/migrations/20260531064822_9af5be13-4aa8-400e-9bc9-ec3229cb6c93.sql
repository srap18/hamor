
-- 1) burn_target_bg: persists a 7-day burned state on target's profile
CREATE OR REPLACE FUNCTION public.burn_target_bg(_target_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _new_until timestamptz := now() + interval '7 days';
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL THEN RAISE EXCEPTION 'target required'; END IF;

  UPDATE public.profiles
     SET bg_burned_until = GREATEST(COALESCE(bg_burned_until, now()), _new_until)
   WHERE id = _target_id;

  RETURN _new_until;
END $$;

GRANT EXECUTE ON FUNCTION public.burn_target_bg(uuid) TO authenticated;

-- 2) Repaired ships must stop fishing (won't return to sea until owner sends them)
CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.ships_owned
     SET hp = max_hp,
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE destroyed_at IS NOT NULL
     AND repair_ends_at IS NOT NULL
     AND repair_ends_at <= now();
$$;

CREATE OR REPLACE FUNCTION public.repair_ship_instant(_ship_id uuid, _gems_cost integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _gems_cost < 0 OR _gems_cost > 10000 THEN RAISE EXCEPTION 'bad cost'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  PERFORM public._mutate_currency(_uid, 0, -_gems_cost, 0, 0);
  UPDATE public.ships_owned
     SET hp = max_hp,
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE id = _ship_id;
END $$;
