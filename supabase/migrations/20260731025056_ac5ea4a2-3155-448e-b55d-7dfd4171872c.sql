CREATE OR REPLACE FUNCTION public._owned_ship_repair_seconds(_template_id integer, _catalog_code text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public._ship_repair_seconds(
    COALESCE(
      (SELECT sc.market_level_required FROM public.ship_catalog sc WHERE sc.code = _catalog_code LIMIT 1),
      _template_id,
      1
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public._trg_stamp_ship_damage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _max_hp integer;
  _missing integer;
  _full_seconds integer;
BEGIN
  _max_hp := GREATEST(1, COALESCE(NEW.max_hp, 100));
  IF COALESCE(NEW.hp, 0) < COALESCE(OLD.hp, 0) THEN
    NEW.last_damaged_at := clock_timestamp();
    IF COALESCE(NEW.hp, 0) > 0 AND NEW.destroyed_at IS NULL THEN
      _missing := GREATEST(0, _max_hp - COALESCE(NEW.hp, 0));
      _full_seconds := public._owned_ship_repair_seconds(NEW.template_id, NEW.catalog_code);
      NEW.repair_started_hp := COALESCE(NEW.hp, 0);
      NEW.passive_repair_ends_at := clock_timestamp() + make_interval(secs => GREATEST(1, CEIL(_full_seconds::numeric * _missing::numeric / _max_hp::numeric)::integer));
    ELSE
      NEW.repair_started_hp := NULL;
      NEW.passive_repair_ends_at := NULL;
    END IF;
  ELSIF COALESCE(NEW.hp, 0) >= _max_hp THEN
    NEW.last_damaged_at := NULL;
    NEW.repair_started_hp := NULL;
    NEW.passive_repair_ends_at := NULL;
  END IF;
  RETURN NEW;
END
$function$;

UPDATE public.ships_owned so
SET repair_started_hp = so.hp,
    last_damaged_at = clock_timestamp(),
    passive_repair_ends_at = clock_timestamp() + make_interval(secs => GREATEST(1, CEIL(
      public._owned_ship_repair_seconds(so.template_id, so.catalog_code)::numeric
      * (so.max_hp - so.hp)::numeric / GREATEST(1, so.max_hp)::numeric
    )::integer))
WHERE so.destroyed_at IS NULL AND so.hp > 0 AND so.hp < so.max_hp;