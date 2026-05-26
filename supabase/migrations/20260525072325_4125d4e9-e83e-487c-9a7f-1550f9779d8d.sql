CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_hp int;
  _owner uuid;
  _repair_secs int;
  _code text;
  _tpl int;
  _repair_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, catalog_code, template_id INTO _owner, _code, _tpl
    FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = auth.uid() THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  SELECT COALESCE(repair_seconds, 3600) INTO _repair_secs
    FROM public.ship_catalog
    WHERE (code = _code) OR (market_level_required = _tpl)
    ORDER BY (code = _code) DESC NULLS LAST
    LIMIT 1;
  IF _repair_secs IS NULL OR _repair_secs < 3600 THEN _repair_secs := 3600; END IF;

  UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp,100) - _damage),
        destroyed_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND destroyed_at IS NULL THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND repair_ends_at IS NULL THEN now() + make_interval(secs => _repair_secs) ELSE repair_ends_at END
  WHERE id = _ship_id
  RETURNING hp, ships_owned.repair_ends_at INTO _new_hp, _repair_ends;
  RETURN QUERY SELECT _new_hp, _new_hp = 0, _repair_ends;
END;
$function$;