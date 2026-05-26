CREATE OR REPLACE FUNCTION public.steal_fish(
  _defender_id uuid,
  _max_count integer DEFAULT 5,
  _attacker_ship_id uuid DEFAULT NULL,
  _target_ship_id uuid DEFAULT NULL
)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
  _atk_lvl int;
  _def_lvl int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _defender_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF _max_count IS NULL OR _max_count < 1 THEN _max_count := 1; END IF;
  IF _max_count > 20 THEN _max_count := 20; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _defender_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected until %', _prot;
  END IF;

  -- Enforce: attacker ship level >= target ship level
  IF _attacker_ship_id IS NOT NULL AND _target_ship_id IS NOT NULL THEN
    SELECT template_id INTO _atk_lvl FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _attacker;
    SELECT template_id INTO _def_lvl FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _defender_id;
    IF _atk_lvl IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
    IF _def_lvl IS NULL THEN RAISE EXCEPTION 'target ship not found'; END IF;
    IF _atk_lvl < _def_lvl THEN
      RAISE EXCEPTION 'attacker ship level (%) is lower than target ship level (%)', _atk_lvl, _def_lvl;
    END IF;
  END IF;

  -- Prefer fish attached to the target ship, then fall back to any of defender's fish
  WITH picked AS (
    SELECT id, base_value FROM public.fish_stock
    WHERE user_id = _defender_id
    ORDER BY
      (CASE WHEN _target_ship_id IS NOT NULL AND ship_id = _target_ship_id THEN 0 ELSE 1 END),
      caught_at ASC
    LIMIT _max_count
    FOR UPDATE SKIP LOCKED
  ), moved AS (
    UPDATE public.fish_stock fs
       SET user_id = _attacker, caught_at = now(), ship_id = NULL
      FROM picked
     WHERE fs.id = picked.id
    RETURNING fs.id, picked.base_value AS v
  )
  SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;