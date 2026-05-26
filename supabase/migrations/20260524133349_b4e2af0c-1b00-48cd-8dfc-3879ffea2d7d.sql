
DROP FUNCTION IF EXISTS public.apply_ship_damage(uuid, integer);

CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage int)
RETURNS TABLE(new_hp int, destroyed boolean, repair_ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT COALESCE(repair_seconds, 300) INTO _repair_secs
    FROM public.ship_catalog
    WHERE (code = _code) OR (market_level_required = _tpl)
    ORDER BY (code = _code) DESC NULLS LAST
    LIMIT 1;
  IF _repair_secs IS NULL THEN _repair_secs := 300; END IF;

  UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp,100) - _damage),
        destroyed_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND destroyed_at IS NULL THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND repair_ends_at IS NULL THEN now() + make_interval(secs => _repair_secs) ELSE repair_ends_at END
  WHERE id = _ship_id
  RETURNING hp, ships_owned.repair_ends_at INTO _new_hp, _repair_ends;
  RETURN QUERY SELECT _new_hp, _new_hp = 0, _repair_ends;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ships_owned
    SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
  WHERE destroyed_at IS NOT NULL AND repair_ends_at IS NOT NULL AND repair_ends_at <= now();
$$;
GRANT EXECUTE ON FUNCTION public.finalize_ship_repairs() TO anon, authenticated;
