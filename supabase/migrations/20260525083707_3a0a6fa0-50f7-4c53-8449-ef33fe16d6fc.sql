CREATE OR REPLACE FUNCTION public.steal_fish(_defender_id uuid, _max_count integer DEFAULT 5, _attacker_ship_id uuid DEFAULT NULL::uuid, _target_ship_id uuid DEFAULT NULL::uuid)
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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _defender_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF _max_count IS NULL OR _max_count < 1 THEN _max_count := 1; END IF;
  IF _max_count > 20 THEN _max_count := 20; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _defender_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected until %', _prot;
  END IF;

  WITH picked AS (
    SELECT id, base_value FROM public.fish_stock
    WHERE user_id = _defender_id
    ORDER BY base_value DESC, caught_at ASC
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