
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _new_hp int; _owner uuid; _tpl int; _repair_secs int; _repair_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, template_id INTO _owner, _tpl FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = auth.uid() THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;
  _tpl := GREATEST(1, LEAST(30, COALESCE(_tpl, 1)));
  -- Tiered repair time:
  --  L1..10  : 1h  -> 5h
  --  L11..20 : 5h  -> 10h
  --  L21..25 : 11h -> 20h
  --  L26..30 : 21h -> 24h
  IF _tpl <= 10 THEN
    _repair_secs := ROUND(3600  + (_tpl - 1)::numeric  * (18000 - 3600)  / 9.0)::int;
  ELSIF _tpl <= 20 THEN
    _repair_secs := ROUND(18000 + (_tpl - 11)::numeric * (36000 - 18000) / 9.0)::int;
  ELSIF _tpl <= 25 THEN
    _repair_secs := ROUND(39600 + (_tpl - 21)::numeric * (72000 - 39600) / 4.0)::int;
  ELSE
    _repair_secs := ROUND(75600 + (_tpl - 26)::numeric * (86400 - 75600) / 4.0)::int;
  END IF;
  UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp,100) - _damage),
        destroyed_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND destroyed_at IS NULL THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND repair_ends_at IS NULL THEN now() + make_interval(secs => _repair_secs) ELSE repair_ends_at END
  WHERE id = _ship_id
  RETURNING hp, ships_owned.repair_ends_at INTO _new_hp, _repair_ends;
  RETURN QUERY SELECT _new_hp, _new_hp = 0, _repair_ends;
END; $function$;
